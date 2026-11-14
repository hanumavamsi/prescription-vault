/**
 * All data access goes through here. Screens never call supabase directly,
 * except auth calls in src/lib/auth.tsx.
 */
import * as Crypto from 'expo-crypto';

import { readBytes } from '@/lib/bytes';
import { inviteBaseUrl } from '@/lib/runtime';
import { supabase } from '@/lib/supabase';
import type {
  DocDetails,
  DocType,
  Document,
  DocumentPage,
  InvitePreview,
  LocalPage,
  Profile,
  ProfileWithRole,
  Viewer,
} from '@/lib/types';

const BUCKET = 'documents';
export const MAX_PAGE_BYTES = 10 * 1024 * 1024;

/** Cloud storage for this account (own + managed profiles) is at or over its quota. */
export class QuotaExceededError extends Error {
  constructor(
    public used: number,
    public quota: number,
  ) {
    super('Cloud storage full');
    this.name = 'QuotaExceededError';
  }
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Not signed in');
  return id;
}

// ------------------------------------------------------------------ profiles

/** Own profile first, then managed profiles, then people who shared with me. */
export async function listProfiles(): Promise<ProfileWithRole[]> {
  const uid = await currentUserId();
  const [profiles, grants] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at').then(must<Profile[]>),
    supabase.from('access_grants').select('profile_id').eq('viewer_id', uid).then(must<{ profile_id: string }[]>),
  ]);
  const shared = new Set(grants.map((g) => g.profile_id));
  const rank = { self: 0, managed: 1, viewer: 2 } as const;
  return profiles
    .filter((p) => p.user_id === uid || p.manager_id === uid || shared.has(p.id))
    .map((p): ProfileWithRole => ({
      ...p,
      role: p.user_id === uid ? 'self' : p.manager_id === uid ? 'managed' : 'viewer',
    }))
    .sort((a, b) => rank[a.role] - rank[b.role]);
}

export async function getProfile(id: string): Promise<ProfileWithRole> {
  const all = await listProfiles();
  const p = all.find((x) => x.id === id);
  if (!p) throw new Error('Profile not found');
  return p;
}

export async function createManagedProfile(displayName: string, relation?: string): Promise<Profile> {
  const uid = await currentUserId();
  return must(
    await supabase
      .from('profiles')
      .insert({ display_name: displayName.trim(), relation: relation?.trim() || null, manager_id: uid })
      .select()
      .single(),
  );
}

export async function updateProfile(id: string, patch: { display_name?: string; relation?: string | null }) {
  must(await supabase.from('profiles').update(patch).eq('id', id));
}

/** Deletes a managed profile and its files. */
export async function deleteManagedProfile(id: string) {
  const docs = must(await supabase.from('documents').select('id').eq('profile_id', id));
  for (const d of docs) await deleteDocument(d.id);
  must(await supabase.from('profiles').delete().eq('id', id));
}

// ------------------------------------------------------------------ documents

export async function listDocuments(profileId: string, type?: DocType): Promise<Document[]> {
  let q = supabase
    .from('documents')
    .select('*')
    .eq('profile_id', profileId)
    .order('doc_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (type) q = q.eq('type', type);
  return must(await q);
}

export async function getDocument(id: string): Promise<{ doc: Document; pages: DocumentPage[] }> {
  const [doc, pages] = await Promise.all([
    supabase.from('documents').select('*').eq('id', id).single().then(must<Document>),
    supabase.from('document_pages').select('*').eq('document_id', id).order('page_no').then(must<DocumentPage[]>),
  ]);
  return { doc, pages };
}

export async function updateDocument(id: string, patch: Partial<DocDetails>) {
  must(await supabase.from('documents').update(patch).eq('id', id));
}

export async function deleteDocument(id: string) {
  const pages = must(await supabase.from('document_pages').select('storage_path').eq('document_id', id));
  if (pages.length) {
    const { error } = await supabase.storage.from(BUCKET).remove(pages.map((p) => p.storage_path));
    if (error) throw new Error(error.message);
  }
  must(await supabase.from('documents').delete().eq('id', id));
}

/**
 * Creates a document and uploads its pages. On any failure the partial document is removed.
 * onProgress reports pages uploaded so far.
 */
export async function createDocument(
  input: {
    profileId: string;
    type: DocType;
    docDate: string;
    title?: string;
    doctor?: string;
    specialty?: string;
    hospital?: string;
    private?: boolean;
    pages: LocalPage[];
  },
  onProgress?: (done: number, total: number) => void,
): Promise<Document> {
  if (!input.pages.length) throw new Error('Add at least one page');
  const uid = await currentUserId();
  const usage = await getStorageUsage();
  if (usage.used >= usage.quota) throw new QuotaExceededError(usage.used, usage.quota);
  const doc = must<Document>(
    await supabase
      .from('documents')
      .insert({
        profile_id: input.profileId,
        type: input.type,
        doc_date: input.docDate,
        title: input.title?.trim() || null,
        doctor: input.doctor?.trim() || null,
        specialty: input.specialty?.trim() || null,
        hospital: input.hospital?.trim() || null,
        private: input.private ?? false,
        created_by: uid,
      })
      .select()
      .single(),
  );

  const uploaded: string[] = [];
  let sizeBytes = 0;
  try {
    for (let i = 0; i < input.pages.length; i++) {
      const page = input.pages[i];
      const bytes = await readBytes(page.uri);
      if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error(`Page ${i + 1} is larger than 10 MB`);
      const ext = page.mime === 'application/pdf' ? 'pdf' : page.mime === 'image/png' ? 'png' : 'jpg';
      const path = `${input.profileId}/${doc.id}/${i + 1}-${Crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: page.mime });
      if (error) {
        // The storage policy refuses uploads at quota (see the storage_quota migration); RLS errors have other causes too.
        if (/row-level security/i.test(error.message)) {
          const now = await getStorageUsage().catch(() => null);
          if (now && now.used >= now.quota) throw new QuotaExceededError(now.used, now.quota);
        }
        throw new Error(error.message);
      }
      uploaded.push(path);
      sizeBytes += bytes.byteLength;
      must(
        await supabase.from('document_pages').insert({
          document_id: doc.id,
          page_no: i + 1,
          storage_path: path,
          mime: page.mime,
          size_bytes: bytes.byteLength,
        }),
      );
      onProgress?.(i + 1, input.pages.length);
    }
  } catch (e) {
    if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded);
    await supabase.from('documents').delete().eq('id', doc.id);
    throw e;
  }
  return { ...doc, page_count: input.pages.length, size_bytes: sizeBytes };
}

/** Short-lived signed URL for a page. Use src/lib/cache.ts for display. */
export async function signedPageUrl(storagePath: string, expiresIn = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresIn);
  if (error || !data) throw new Error(error?.message ?? 'Could not load file');
  return data.signedUrl;
}

/** Downloads a page with the signed-in user's session (storage RLS applies). Nothing shareable is created. */
export async function downloadPage(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) throw new Error(error?.message ?? 'Could not load file');
  return data;
}

// ------------------------------------------------------------------ family / invites

export function inviteUrl(token: string) {
  return `${inviteBaseUrl()}/${token}`;
}

/** Link asking someone to let me view their records. */
export async function createViewInvite(): Promise<string> {
  const token = must<string>(await supabase.rpc('create_invite', { p_purpose: 'view' }));
  return inviteUrl(token);
}

/** Link handing a managed profile over to the person it belongs to. */
export async function createClaimInvite(profileId: string): Promise<string> {
  const token = must<string>(await supabase.rpc('create_invite', { p_purpose: 'claim', p_profile_id: profileId }));
  return inviteUrl(token);
}

export async function getInvite(token: string): Promise<InvitePreview | null> {
  const rows = must<InvitePreview[]>(await supabase.rpc('get_invite', { p_token: token }));
  return rows[0] ?? null;
}

export async function acceptInvite(token: string): Promise<void> {
  must(await supabase.rpc('accept_invite', { p_token: token }));
}

export async function declineInvite(token: string): Promise<void> {
  must(await supabase.rpc('decline_invite', { p_token: token }));
}

/** People who can see my records. */
export async function listMyViewers(): Promise<Viewer[]> {
  return must<Viewer[]>(await supabase.rpc('list_my_viewers'));
}

/** Remove someone's access to my records, or stop viewing someone's (both are a grant delete). */
export async function revokeGrant(grantId: string) {
  must(await supabase.from('access_grants').delete().eq('id', grantId));
}

/** Stop viewing a profile that was shared with me. */
export async function leaveSharedProfile(profileId: string) {
  const uid = await currentUserId();
  must(await supabase.from('access_grants').delete().eq('profile_id', profileId).eq('viewer_id', uid));
}

// ------------------------------------------------------------------ account

/** False while the account is on the beta waitlist (see the waitlist migration). */
export async function isApproved(): Promise<boolean> {
  return must<boolean>(await supabase.rpc('is_approved'));
}

/** Bytes of cloud storage used by my own and managed profiles, and the account quota. */
export async function getStorageUsage(): Promise<{ used: number; quota: number }> {
  const [used, quota] = await Promise.all([
    supabase.rpc('storage_used_bytes').then(must<number>),
    supabase.rpc('storage_quota_bytes').then(must<number>),
  ]);
  return { used: Number(used), quota: Number(quota) };
}

export async function deleteAccount() {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw new Error(error.message);
  await supabase.auth.signOut();
}
