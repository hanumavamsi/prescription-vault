/**
 * All data access goes through here. Screens never call the backend directly.
 * Data lives behind the Cloudflare Worker in cloudflare/ (D1 + R2); Supabase is only used for
 * sign-in (src/lib/auth.tsx), and its access token authorizes every call below.
 */
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

export const MAX_PAGE_BYTES = 20 * 1024 * 1024;

async function call<T = unknown>(method: string, path: string, body?: unknown, contentType?: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  if (!API_URL) throw new Error('Missing EXPO_PUBLIC_API_URL. Copy .env.example to .env.');
  const raw = body instanceof ArrayBuffer;
  const res = await fetch(API_URL + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': contentType ?? 'application/json' }),
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json as T;
}

// ------------------------------------------------------------------ profiles

/** Own profile first, then managed profiles, then people who shared with me. */
export function listProfiles(): Promise<ProfileWithRole[]> {
  return call('GET', '/profiles');
}

export async function getProfile(id: string): Promise<ProfileWithRole> {
  const all = await listProfiles();
  const p = all.find((x) => x.id === id);
  if (!p) throw new Error('Profile not found');
  return p;
}

export function createManagedProfile(displayName: string, relation?: string): Promise<Profile> {
  return call('POST', '/profiles', { display_name: displayName.trim(), relation: relation?.trim() || null });
}

export async function updateProfile(id: string, patch: { display_name?: string; relation?: string | null }) {
  await call('PATCH', `/profiles/${id}`, patch);
}

/** Deletes a managed profile and its files. */
export async function deleteManagedProfile(id: string) {
  await call('DELETE', `/profiles/${id}`);
}

// ------------------------------------------------------------------ documents

export function listDocuments(profileId: string, type?: DocType): Promise<Document[]> {
  return call('GET', `/profiles/${profileId}/documents${type ? `?type=${type}` : ''}`);
}

export function getDocument(id: string): Promise<{ doc: Document; pages: DocumentPage[] }> {
  return call('GET', `/documents/${id}`);
}

export async function updateDocument(id: string, patch: Partial<DocDetails>) {
  await call('PATCH', `/documents/${id}`, patch);
}

/** Deletes a document and its files. */
export async function deleteDocument(id: string) {
  await call('DELETE', `/documents/${id}`);
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
    pages: LocalPage[];
  },
  onProgress?: (done: number, total: number) => void,
): Promise<Document> {
  if (!input.pages.length) throw new Error('Add at least one page');
  const doc = await call<Document>('POST', '/documents', {
    profile_id: input.profileId,
    type: input.type,
    doc_date: input.docDate,
    title: input.title?.trim() || null,
    doctor: input.doctor?.trim() || null,
    specialty: input.specialty?.trim() || null,
    hospital: input.hospital?.trim() || null,
  });

  try {
    for (let i = 0; i < input.pages.length; i++) {
      const page = input.pages[i];
      const bytes = await readBytes(page.uri);
      if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error(`Page ${i + 1} is larger than 20 MB`);
      await call('PUT', `/documents/${doc.id}/pages/${i + 1}`, bytes, page.mime);
      onProgress?.(i + 1, input.pages.length);
    }
  } catch (e) {
    // The Worker removes the uploaded files with the document.
    await deleteDocument(doc.id).catch(() => {});
    throw e;
  }
  return { ...doc, page_count: input.pages.length };
}

/** Short-lived signed URL for a page. Use src/lib/cache.ts for display. */
export async function signedPageUrl(storagePath: string, expiresIn = 300): Promise<string> {
  const { url } = await call<{ url: string }>('GET', `/sign?path=${encodeURIComponent(storagePath)}&ttl=${expiresIn}`);
  return url;
}

// ------------------------------------------------------------------ family / invites

export function inviteUrl(token: string) {
  return `${inviteBaseUrl()}/${token}`;
}

/** Link asking someone to let me view their records. */
export async function createViewInvite(): Promise<string> {
  const { token } = await call<{ token: string }>('POST', '/invites', { purpose: 'view' });
  return inviteUrl(token);
}

/** Link handing a managed profile over to the person it belongs to. */
export async function createClaimInvite(profileId: string): Promise<string> {
  const { token } = await call<{ token: string }>('POST', '/invites', { purpose: 'claim', profile_id: profileId });
  return inviteUrl(token);
}

export function getInvite(token: string): Promise<InvitePreview | null> {
  return call('GET', `/invites/${encodeURIComponent(token)}`);
}

export async function acceptInvite(token: string): Promise<void> {
  await call('POST', `/invites/${encodeURIComponent(token)}/accept`);
}

export async function declineInvite(token: string): Promise<void> {
  await call('POST', `/invites/${encodeURIComponent(token)}/decline`);
}

/** People who can see my records. */
export function listMyViewers(): Promise<Viewer[]> {
  return call('GET', '/viewers');
}

/** Remove someone's access to my records, or stop viewing someone's (both are a grant delete). */
export async function revokeGrant(grantId: string) {
  await call('DELETE', `/grants/${grantId}`);
}

/** Stop viewing a profile that was shared with me. */
export async function leaveSharedProfile(profileId: string) {
  await call('DELETE', `/shared/${profileId}`);
}

// ------------------------------------------------------------------ account

/** False while the account is on the beta waitlist (see the waitlist migration). */
export async function isApproved(): Promise<boolean> {
  return must<boolean>(await supabase.rpc('is_approved'));
}

export async function deleteAccount() {
  await call('DELETE', '/account');
  await supabase.auth.signOut();
}
