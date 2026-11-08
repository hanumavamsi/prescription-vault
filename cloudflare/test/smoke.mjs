// End-to-end check of the Worker's access rules against local D1 + R2.
// Usage (from cloudflare/): cp .dev.vars.example .dev.vars && npm run db:migrate:local && npx wrangler dev &
//                           npm test
import { SignJWT } from 'jose';

const API = process.env.API_URL ?? 'http://127.0.0.1:8787';
const SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET ?? 'dev-jwt-secret-at-least-32-characters-long');

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok    ' : 'FAIL  '} ${msg}`);
  if (!cond) failures++;
};

async function user(tag) {
  const sub = crypto.randomUUID();
  const token = await new SignJWT({ email: `${tag}@e2e.dev`, user_metadata: { full_name: tag } })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setExpirationTime('1h')
    .sign(SECRET);
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const me = (await call('GET', '/profiles')).data.find((p) => p.role === 'self');
  return { sub, call, profileId: me.id, name: me.display_name };
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

async function addDoc(u, profileId, title) {
  const doc = (await u.call('POST', '/documents', { profile_id: profileId, type: 'report', title, doc_date: '2026-11-01' })).data;
  const page = await u.call('PUT', `/documents/${doc.id}/pages/1`, jpeg, { 'Content-Type': 'image/jpeg' });
  return { doc, page: page.data };
}

const fileVia = async (u, path) => {
  const s = await u.call('GET', `/sign?path=${encodeURIComponent(path)}`);
  if (s.status !== 200) return { status: s.status };
  const r = await fetch(s.data.url);
  return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
};

// ---------------------------------------------------------------- run

check((await fetch(API + '/profiles')).status === 401, 'no token -> 401');
check((await fetch(API + '/profiles', { headers: { Authorization: 'Bearer junk' } })).status === 401, 'bad token -> 401');

const forged = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('x').setAudience('authenticated')
  .setExpirationTime('1h').sign(new TextEncoder().encode('wrong-secret-wrong-secret-wrong-secret'));
check((await fetch(API + '/profiles', { headers: { Authorization: `Bearer ${forged}` } })).status === 401, 'token signed with wrong secret -> 401');
const anon = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('x').setAudience('anon')
  .setExpirationTime('1h').sign(SECRET);
check((await fetch(API + '/profiles', { headers: { Authorization: `Bearer ${anon}` } })).status === 401, 'non-authenticated audience -> 401');

const asha = await user('asha');
const ravi = await user('ravi');
const eve = await user('eve');
check(asha.name === 'asha', 'own profile created on first request with name from token');

// documents + files
const mine = await addDoc(asha, asha.profileId, 'Blood test');
check(mine.page.page_no === 1 && mine.page.mime === 'image/jpeg', 'page uploaded');
const got = await asha.call('GET', `/documents/${mine.doc.id}`);
check(got.data.doc.page_count === 1 && got.data.pages.length === 1, 'page_count trigger keeps count');
const f = await fileVia(asha, mine.page.storage_path);
check(f.status === 200 && f.bytes.length === jpeg.length, 'owner can download via signed url');
const tampered = (await asha.call('GET', `/sign?path=${encodeURIComponent(mine.page.storage_path)}`)).data.url.replace(/sig=./, 'sig=0');
check((await fetch(tampered)).status === 403, 'tampered signature rejected');

check((await eve.call('GET', `/documents/${mine.doc.id}`)).status === 404, 'stranger cannot read document');
check((await fileVia(eve, mine.page.storage_path)).status === 404, 'stranger cannot sign file url');
check((await eve.call('GET', `/profiles/${asha.profileId}/documents`)).status === 404, 'stranger cannot list documents');
check((await eve.call('POST', '/documents', { profile_id: asha.profileId, type: 'report' })).status === 404, 'stranger cannot add document');
check((await eve.call('PUT', `/documents/${mine.doc.id}/pages/2`, jpeg, { 'Content-Type': 'image/jpeg' })).status === 404, 'stranger cannot upload page');
check((await eve.call('PATCH', `/documents/${mine.doc.id}`, { title: 'x' })).status === 404, 'stranger cannot edit document');
check((await eve.call('PATCH', `/profiles/${asha.profileId}`, { display_name: 'x' })).status === 404, 'stranger cannot rename profile');
check((await asha.call('PUT', `/documents/${mine.doc.id}/pages/2`, jpeg, { 'Content-Type': 'text/html' })).status === 400, 'non-image upload refused');
check((await asha.call('POST', '/documents', { profile_id: asha.profileId, type: 'bogus' })).status === 400, 'bad type refused');

// view invite: ravi asks to see asha's records
const vInv = (await ravi.call('POST', '/invites', { purpose: 'view' })).data.token;
const preview = (await asha.call('GET', `/invites/${vInv}`)).data;
check(preview.from_name === 'ravi' && preview.valid === true && preview.is_own === false, 'invite preview');
check((await ravi.call('POST', `/invites/${vInv}/accept`)).status === 400, 'cannot accept own invite');
check((await asha.call('POST', `/invites/${vInv}/accept`)).status === 200, 'asha approves view invite');
check((await eve.call('POST', `/invites/${vInv}/accept`)).status === 400, 'used invite cannot be reused');
const raviList = (await ravi.call('GET', '/profiles')).data;
check(raviList.some((p) => p.id === asha.profileId && p.role === 'viewer'), 'ravi sees asha as viewer');
check((await fileVia(ravi, mine.page.storage_path)).status === 200, 'viewer can download');
check((await ravi.call('PATCH', `/documents/${mine.doc.id}`, { title: 'x' })).status === 404, 'viewer cannot edit');
check((await ravi.call('DELETE', `/documents/${mine.doc.id}`)).status === 404, 'viewer cannot delete');
const viewers = (await asha.call('GET', '/viewers')).data;
check(viewers.length === 1 && viewers[0].display_name === 'ravi', 'asha lists ravi as viewer');

// claim invite: asha manages "Dad", hands it to eve
const dad = (await asha.call('POST', '/profiles', { display_name: 'Dad', relation: 'Father' })).data;
const dadDoc = await addDoc(asha, dad.id, 'ECG');
check((await eve.call('POST', '/invites', { purpose: 'claim', profile_id: dad.id })).status === 400, 'cannot claim-invite others profiles');
const cInv = (await asha.call('POST', '/invites', { purpose: 'claim', profile_id: dad.id })).data.token;
check((await eve.call('POST', `/invites/${cInv}/accept`)).status === 200, 'eve claims Dad');
const eveDocs = (await eve.call('GET', `/profiles/${eve.profileId}/documents`)).data;
check(eveDocs.some((d) => d.id === dadDoc.doc.id), 'claimed documents moved to eve');
check((await fileVia(eve, dadDoc.page.storage_path)).status === 200, 'eve can download moved file (old path)');
check((await fileVia(asha, dadDoc.page.storage_path)).status === 200, 'former manager keeps read access');
check(!(await asha.call('GET', '/profiles')).data.some((p) => p.id === dad.id), 'managed profile gone');

// revoke + leave
check((await eve.call('DELETE', `/grants/${viewers[0].grant_id}`)).status === 200, 'stranger grant delete is a no-op');
check((await fileVia(ravi, mine.page.storage_path)).status === 200, '...and access remains');
await asha.call('DELETE', `/grants/${viewers[0].grant_id}`);
check((await fileVia(ravi, mine.page.storage_path)).status === 404, 'revoked viewer loses access');
await asha.call('DELETE', `/shared/${eve.profileId}`);
check((await fileVia(asha, dadDoc.page.storage_path)).status === 404, 'leaving a shared profile drops access');

// decline
const dInv = (await ravi.call('POST', '/invites', { purpose: 'view' })).data.token;
await eve.call('POST', `/invites/${dInv}/decline`);
check((await eve.call('GET', `/invites/${dInv}`)).data.valid === false, 'declined invite is no longer valid');

// delete document removes its file
const signed = (await asha.call('GET', `/sign?path=${encodeURIComponent(mine.page.storage_path)}`)).data.url;
await asha.call('DELETE', `/documents/${mine.doc.id}`);
check((await fetch(signed)).status === 404, 'deleted document file is gone from R2');

// account deletion
const evesSigned = (await eve.call('GET', `/sign?path=${encodeURIComponent(dadDoc.page.storage_path)}`)).data.url;
check((await eve.call('DELETE', '/account')).status === 200, 'eve deletes account');
check((await fetch(evesSigned)).status === 404, 'account files removed');
const fresh = (await eve.call('GET', '/profiles')).data;
check(fresh.length === 1 && fresh[0].id !== eve.profileId, 'old rows gone (a new empty profile on next use)');

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
