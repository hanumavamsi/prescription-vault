/**
 * All data access goes through here. Screens never call supabase directly,
 * except auth calls in src/lib/auth.tsx.
 */
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';
import type {
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
export const MAX_PAGE_BYTES = 20 * 1024 * 1024;

/** Base URL invite links point to. Universal link domain in production, app scheme as fallback. */
const INVITE_BASE = process.env.EXPO_PUBLIC_INVITE_BASE_URL ?? 'prescriptionvault://invite';

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

/** Most recent documents across every profile I can see. */
export async function listRecentDocuments(limit = 10): Promise<Document[]> {
  return must(
    await supabase.from('documents').select('*').order('created_at', { ascending: false }).limit(limit),
  );
}

export async function getDocument(id: string): Promise<{ doc: Document; pages: DocumentPage[] }> {
  const [doc, pages] = await Promise.all([
    supabase.from('documents').select('*').eq('id', id).single().then(must<Document>),
    supabase.from('document_pages').select('*').eq('document_id', id).order('page_no').then(must<DocumentPage[]>),
  ]);
  return { doc, pages };
}

export async function updateDocument(id: string, patch: { type?: DocType; doc_date?: string; title?: string | null }) {
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
  input: { profileId: string; type: DocType; docDate: string; title?: string; pages: LocalPage[] },
  onProgress?: (done: number, total: number) => void,
): Promise<Document> {
  if (!input.pages.length) throw new Error('Add at least one page');
  const uid = await currentUserId();
  const doc = must<Document>(
    await supabase
      .from('documents')
      .insert({
        profile_id: input.profileId,
        type: input.type,
        doc_date: input.docDate,
        title: input.title?.trim() || null,
        created_by: uid,
      })
      .select()
      .single(),
  );

  const uploaded: string[] = [];
  try {
    for (let i = 0; i < input.pages.length; i++) {
      const page = input.pages[i];
      const bytes = await new File(page.uri).arrayBuffer();
      if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error(`Page ${i + 1} is larger than 20 MB`);
      const ext = page.mime === 'application/pdf' ? 'pdf' : page.mime === 'image/png' ? 'png' : 'jpg';
      const path = `${input.profileId}/${doc.id}/${i + 1}-${Crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: page.mime });
      if (error) throw new Error(error.message);
      uploaded.push(path);
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
  return { ...doc, page_count: input.pages.length };
}

/** Short-lived signed URL for a page. Use src/lib/cache.ts for display. */
export async function signedPageUrl(storagePath: string, expiresIn = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresIn);
  if (error || !data) throw new Error(error?.message ?? 'Could not load file');
  return data.signedUrl;
}

// ------------------------------------------------------------------ family / invites

export function inviteUrl(token: string) {
  return `${INVITE_BASE}/${token}`;
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

export async function deleteAccount() {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw new Error(error.message);
  await supabase.auth.signOut();
}
