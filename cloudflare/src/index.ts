/**
 * Prescription Vault API on Cloudflare: D1 for data, R2 for page files.
 * Login stays on Supabase Auth; every request carries the Supabase access token, verified here.
 * This Worker is the only thing that touches D1/R2, so every access rule from the Supabase RLS
 * policies (supabase/migrations/20261031000000_init.sql) is enforced in this file.
 */
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  SUPABASE_URL: string;
  /** Only for HS256 tokens (legacy projects, local stack). Other tokens are checked against the project's JWKS. */
  SUPABASE_JWT_SECRET?: string;
  /** Only used to delete the auth user on account deletion. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Signs short-lived file URLs. */
  FILE_SIGNING_SECRET: string;
}

const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
const DOC_FIELDS = ['type', 'doc_date', 'title', 'doctor', 'specialty', 'hospital'] as const;
const INVITE_DAYS = 7;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------ auth

function hsSecret(env: Env): string {
  // Never verify HMAC tokens with an empty key: anyone could sign those.
  if (!env.SUPABASE_JWT_SECRET) throw new Error('HS256 not configured');
  return env.SUPABASE_JWT_SECRET;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function verifyUser(req: Request, env: Env): Promise<JWTPayload & { sub: string }> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Not signed in');
  try {
    const opts = { audience: 'authenticated' };
    // Legacy/local projects sign HS256 with the shared secret; current ones sign ES256/RS256 (JWKS).
    const { payload } =
      decodeProtectedHeader(token).alg === 'HS256'
        ? await jwtVerify(token, new TextEncoder().encode(hsSecret(env)), { ...opts, algorithms: ['HS256'] })
        : await jwtVerify(token, (jwks ??= createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`))), opts);
    if (!payload.sub) throw new Error('no sub');
    return payload as JWTPayload & { sub: string };
  } catch {
    throw new HttpError(401, 'Not signed in');
  }
}

/** Replaces the Supabase signup trigger: the own profile is created on first use. */
async function myProfileId(db: D1Database, user: JWTPayload & { sub: string }): Promise<string> {
  const row = await db.prepare('select id from profiles where user_id = ?').bind(user.sub).first<{ id: string }>();
  if (row) return row.id;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const name = (pick(meta.full_name) ?? pick(meta.name) ?? pick(String(user.email ?? '').split('@')[0]) ?? 'Me').slice(0, 80);
  await db
    .prepare('insert into profiles (id, user_id, display_name) values (?, ?, ?) on conflict (user_id) do nothing')
    .bind(uuid(), user.sub, name)
    .run();
  return (await db.prepare('select id from profiles where user_id = ?').bind(user.sub).first<{ id: string }>())!.id;
}

async function canEdit(db: D1Database, uid: string, profileId: unknown): Promise<boolean> {
  if (typeof profileId !== 'string') return false;
  return !!(await db
    .prepare('select 1 from profiles where id = ?1 and (user_id = ?2 or manager_id = ?2)')
    .bind(profileId, uid)
    .first());
}

async function canView(db: D1Database, uid: string, profileId: unknown): Promise<boolean> {
  if (typeof profileId !== 'string') return false;
  if (await canEdit(db, uid, profileId)) return true;
  return !!(await db.prepare('select 1 from access_grants where profile_id = ? and viewer_id = ?').bind(profileId, uid).first());
}

async function docProfile(db: D1Database, docId: string): Promise<string> {
  const row = await db.prepare('select profile_id from documents where id = ?').bind(docId).first<{ profile_id: string }>();
  if (!row) throw new HttpError(404, 'Document not found');
  return row.profile_id;
}

// ------------------------------------------------------------------ signed file urls

async function hmacKey(env: Env) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.FILE_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

async function signFile(env: Env, origin: string, path: string, ttl: number) {
  const exp = Math.floor(Date.now() / 1000) + Math.min(Math.max(ttl, 1), 3600);
  const sig = hex(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(`${path}\n${exp}`)));
  return `${origin}/files/${encodeURIComponent(path)}?exp=${exp}&sig=${sig}`;
}

async function serveFile(env: Env, url: URL, path: string): Promise<Response> {
  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig') ?? '';
  if (!exp || exp < Date.now() / 1000 || !/^[0-9a-f]{64}$/.test(sig)) throw new HttpError(403, 'Link expired');
  const sigBytes = new Uint8Array(sig.match(/../g)!.map((h) => parseInt(h, 16)));
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), sigBytes, new TextEncoder().encode(`${path}\n${exp}`));
  if (!ok) throw new HttpError(403, 'Link expired');
  const obj = await env.FILES.get(path);
  if (!obj) throw new HttpError(404, 'File not found');
  return new Response(obj.body, {
    headers: {
      ...cors,
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=300',
    },
  });
}

/** Deletes the files of every document in the given profiles. Run before deleting the rows. */
async function removeProfileFiles(db: D1Database, files: R2Bucket, profileIds: string[]) {
  if (!profileIds.length) return;
  const marks = profileIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(`select p.storage_path from document_pages p join documents d on d.id = p.document_id where d.profile_id in (${marks})`)
    .bind(...profileIds)
    .all<{ storage_path: string }>();
  const paths = results.map((r) => r.storage_path);
  for (let i = 0; i < paths.length; i += 1000) await files.delete(paths.slice(i, i + 1000));
}

// ------------------------------------------------------------------ routes

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    if (b && typeof b === 'object' && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, 'Bad request');
}

/** Optional text field: trimmed, empty -> null. Non-strings are rejected. */
function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'string') throw new HttpError(400, 'Bad request');
  return v.trim() || null;
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const m = req.method;
  const db = env.DB;

  // Public: signed file download (img/src cannot send an Authorization header).
  if (m === 'GET' && seg[0] === 'files' && seg.length === 2) return serveFile(env, url, seg[1]);

  const user = await verifyUser(req, env);
  const uid = user.sub;
  const route = `${m} /${seg.map((s, i) => (i % 2 ? ':' : s)).join('/')}`;
  const id = seg[1];

  switch (route) {
    // ---------------------------------------------------------- profiles
    case 'GET /profiles': {
      await myProfileId(db, user);
      const { results } = await db
        .prepare(
          `select p.*, case when p.user_id = ?1 then 'self' when p.manager_id = ?1 then 'managed' else 'viewer' end as role
           from profiles p
           where p.user_id = ?1 or p.manager_id = ?1
              or p.id in (select profile_id from access_grants where viewer_id = ?1)
           order by case when p.user_id = ?1 then 0 when p.manager_id = ?1 then 1 else 2 end, p.created_at`,
        )
        .bind(uid)
        .all();
      return json(results);
    }
    case 'POST /profiles': {
      const b = await body(req);
      const row = await db
        .prepare('insert into profiles (id, manager_id, display_name, relation) values (?, ?, ?, ?) returning *')
        .bind(uuid(), uid, text(b.display_name) ?? '', text(b.relation))
        .first();
      return json(row, 201);
    }
    case 'PATCH /profiles/:': {
      if (!(await canEdit(db, uid, id))) throw new HttpError(404, 'Profile not found');
      const b = await body(req);
      const sets: string[] = [];
      const vals: unknown[] = [];
      if ('display_name' in b) {
        sets.push('display_name = ?');
        vals.push(text(b.display_name) ?? '');
      }
      if ('relation' in b) {
        sets.push('relation = ?');
        vals.push(text(b.relation));
      }
      if (sets.length) await db.prepare(`update profiles set ${sets.join(', ')} where id = ?`).bind(...vals, id).run();
      return json({ ok: true });
    }
    case 'DELETE /profiles/:': {
      const own = await db.prepare('select 1 from profiles where id = ? and manager_id = ?').bind(id, uid).first();
      if (!own) throw new HttpError(404, 'Profile not found');
      await removeProfileFiles(db, env.FILES, [id]);
      await db.prepare('delete from profiles where id = ?').bind(id).run(); // documents, pages, grants cascade
      return json({ ok: true });
    }
    case 'GET /profiles/:/documents': {
      if (!(await canView(db, uid, id))) throw new HttpError(404, 'Profile not found');
      const type = url.searchParams.get('type');
      const { results } = await db
        .prepare(
          `select * from documents where profile_id = ? ${type ? 'and type = ?' : ''} order by doc_date desc, created_at desc`,
        )
        .bind(...(type ? [id, type] : [id]))
        .all();
      return json(results);
    }

    // ---------------------------------------------------------- documents
    case 'POST /documents': {
      const b = await body(req);
      if (!(await canEdit(db, uid, b.profile_id))) throw new HttpError(404, 'Profile not found');
      const row = await db
        .prepare(
          `insert into documents (id, profile_id, type, doc_date, title, doctor, specialty, hospital, created_by)
           values (?, ?, ?, coalesce(?, date('now')), ?, ?, ?, ?, ?) returning *`,
        )
        .bind(uuid(), b.profile_id, text(b.type), text(b.doc_date), text(b.title), text(b.doctor), text(b.specialty), text(b.hospital), uid)
        .first();
      return json(row, 201);
    }
    case 'GET /documents/:': {
      if (!(await canView(db, uid, await docProfile(db, id)))) throw new HttpError(404, 'Document not found');
      const [doc, pages] = await db.batch([
        db.prepare('select * from documents where id = ?').bind(id),
        db.prepare('select * from document_pages where document_id = ? order by page_no').bind(id),
      ]);
      return json({ doc: doc.results[0], pages: pages.results });
    }
    case 'PATCH /documents/:': {
      if (!(await canEdit(db, uid, await docProfile(db, id)))) throw new HttpError(404, 'Document not found');
      const b = await body(req);
      const keys = DOC_FIELDS.filter((k) => k in b);
      if (keys.length) {
        await db
          .prepare(`update documents set ${keys.map((k) => `${k} = ?`).join(', ')} where id = ?`)
          .bind(...keys.map((k) => text(b[k])), id)
          .run();
      }
      return json({ ok: true });
    }
    case 'DELETE /documents/:': {
      if (!(await canEdit(db, uid, await docProfile(db, id)))) throw new HttpError(404, 'Document not found');
      const { results } = await db.prepare('select storage_path from document_pages where document_id = ?').bind(id).all<{ storage_path: string }>();
      if (results.length) await env.FILES.delete(results.map((r) => r.storage_path));
      await db.prepare('delete from documents where id = ?').bind(id).run();
      return json({ ok: true });
    }
    case 'PUT /documents/:/pages/:': {
      const profileId = await docProfile(db, id);
      if (!(await canEdit(db, uid, profileId))) throw new HttpError(404, 'Document not found');
      const pageNo = Number(seg[3]);
      const mime = (req.headers.get('Content-Type') ?? '').split(';')[0].trim();
      const ext = MIME_EXT[mime];
      if (!Number.isInteger(pageNo) || pageNo < 1 || !ext) throw new HttpError(400, 'Unsupported file');
      const size = Number(req.headers.get('Content-Length'));
      if (size > MAX_PAGE_BYTES) throw new HttpError(413, `Page ${pageNo} is larger than 20 MB`);
      const bytes = await req.arrayBuffer();
      if (bytes.byteLength > MAX_PAGE_BYTES) throw new HttpError(413, `Page ${pageNo} is larger than 20 MB`);
      const path = `${profileId}/${id}/${pageNo}-${uuid()}.${ext}`;
      await env.FILES.put(path, bytes, { httpMetadata: { contentType: mime } });
      try {
        const row = await db
          .prepare('insert into document_pages (id, document_id, page_no, storage_path, mime, size_bytes) values (?, ?, ?, ?, ?, ?) returning *')
          .bind(uuid(), id, pageNo, path, mime, bytes.byteLength)
          .first();
        return json(row, 201);
      } catch (e) {
        await env.FILES.delete(path);
        throw e;
      }
    }

    // ---------------------------------------------------------- files
    case 'GET /sign': {
      const path = url.searchParams.get('path') ?? '';
      // Resolve through the page row: after a claim, documents move profiles but files keep their path.
      const row = await db
        .prepare('select d.profile_id from document_pages p join documents d on d.id = p.document_id where p.storage_path = ?')
        .bind(path)
        .first<{ profile_id: string }>();
      if (!row || !(await canView(db, uid, row.profile_id))) throw new HttpError(404, 'File not found');
      return json({ url: await signFile(env, url.origin, path, Number(url.searchParams.get('ttl')) || 300) });
    }

    // ---------------------------------------------------------- invites
    case 'POST /invites': {
      const b = await body(req);
      let profileId: string | null = null;
      if (b.purpose === 'claim') {
        const own = await db.prepare('select 1 from profiles where id = ? and manager_id = ?').bind(b.profile_id, uid).first();
        if (!own) throw new HttpError(400, 'not your managed profile');
        profileId = b.profile_id as string;
      } else if (b.purpose !== 'view') {
        throw new HttpError(400, 'bad purpose');
      }
      const token = hex(crypto.getRandomValues(new Uint8Array(18)).buffer);
      const expires = new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString();
      await db
        .prepare('insert into invites (id, token, from_user, purpose, profile_id, expires_at) values (?, ?, ?, ?, ?, ?)')
        .bind(uuid(), token, uid, b.purpose, profileId, expires)
        .run();
      return json({ token }, 201);
    }
    case 'GET /invites/:': {
      const row = await db
        .prepare(
          `select i.purpose,
                  (select display_name from profiles where user_id = i.from_user) as from_name,
                  (select display_name from profiles where id = i.profile_id) as profile_name,
                  (i.used_at is null and i.expires_at > ?) as valid,
                  (i.from_user = ?) as is_own
           from invites i where i.token = ?`,
        )
        .bind(now(), uid, id)
        .first<Record<string, unknown>>();
      return json(row ? { ...row, valid: !!row.valid, is_own: !!row.is_own } : null);
    }
    case 'POST /invites/:/accept': {
      const mine = await myProfileId(db, user);
      const t = now();
      // Consume atomically so two accepts of one link cannot both succeed.
      const inv = await db
        .prepare(
          `update invites set used_at = ?, used_by = ?
           where token = ? and used_at is null and expires_at > ? and from_user <> ? returning *`,
        )
        .bind(t, uid, id, t, uid)
        .first<{ id: string; from_user: string; purpose: string; profile_id: string | null }>();
      if (!inv) {
        const any = await db.prepare('select from_user from invites where token = ?').bind(id).first<{ from_user: string }>();
        throw new HttpError(400, !any ? 'invite not found' : any.from_user === uid ? 'cannot accept your own invite' : 'invite expired');
      }
      const steps = [];
      if (inv.purpose === 'claim') {
        steps.push(db.prepare('update documents set profile_id = ? where profile_id = ?').bind(mine, inv.profile_id));
        steps.push(db.prepare('delete from profiles where id = ?').bind(inv.profile_id));
      }
      steps.push(
        db
          .prepare('insert into access_grants (id, viewer_id, profile_id) values (?, ?, ?) on conflict (viewer_id, profile_id) do nothing')
          .bind(uuid(), inv.from_user, mine),
      );
      try {
        await db.batch(steps); // a batch is one transaction
      } catch (e) {
        await db.prepare('update invites set used_at = null, used_by = null where id = ?').bind(inv.id).run();
        throw e;
      }
      return json({ profile_id: mine });
    }
    case 'POST /invites/:/decline': {
      await db
        .prepare('update invites set used_at = ?, used_by = ? where token = ? and used_at is null and from_user <> ?')
        .bind(now(), uid, id, uid)
        .run();
      return json({ ok: true });
    }

    // ---------------------------------------------------------- sharing
    case 'GET /viewers': {
      const { results } = await db
        .prepare(
          `select g.id as grant_id, g.viewer_id, vp.display_name, g.created_at as since
           from access_grants g
           join profiles mine on mine.id = g.profile_id and mine.user_id = ?
           left join profiles vp on vp.user_id = g.viewer_id
           order by g.created_at desc`,
        )
        .bind(uid)
        .all();
      return json(results);
    }
    case 'DELETE /grants/:': {
      const g = await db.prepare('select viewer_id, profile_id from access_grants where id = ?').bind(id).first<{ viewer_id: string; profile_id: string }>();
      if (g && (g.viewer_id === uid || (await canEdit(db, uid, g.profile_id)))) {
        await db.prepare('delete from access_grants where id = ?').bind(id).run();
      }
      return json({ ok: true });
    }
    case 'DELETE /shared/:': {
      await db.prepare('delete from access_grants where profile_id = ? and viewer_id = ?').bind(id, uid).run();
      return json({ ok: true });
    }

    // ---------------------------------------------------------- account
    case 'DELETE /account': {
      // Files first, then rows, then the login: a failure part-way never leaves files without rows.
      const { results } = await db
        .prepare('select id from profiles where user_id = ?1 or manager_id = ?1')
        .bind(uid)
        .all<{ id: string }>();
      const ids = results.map((r) => r.id);
      await removeProfileFiles(db, env.FILES, ids);
      await db.batch([
        ...ids.map((pid) => db.prepare('delete from profiles where id = ?').bind(pid)),
        db.prepare('delete from access_grants where viewer_id = ?').bind(uid),
        db.prepare('delete from invites where from_user = ?').bind(uid),
      ]);
      if (env.SUPABASE_SERVICE_ROLE_KEY) {
        const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
          method: 'DELETE',
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
        });
        if (!res.ok) throw new HttpError(502, 'Could not delete login');
      }
      return json({ ok: true });
    }
  }
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      return await handle(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      // Constraint failures (bad type, too-long text, ...) are the client's fault.
      if (/constraint failed/i.test(msg)) return json({ error: 'Invalid value' }, 400);
      console.error(e);
      return json({ error: 'Server error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
