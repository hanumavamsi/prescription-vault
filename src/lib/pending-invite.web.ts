/**
 * Web version of pending-invite.ts (SecureStore does not exist in the browser).
 * Kept in localStorage so it survives the Google sign-in redirect and a reload, and expires
 * after a day so a forgotten invite doesn't pop up much later.
 */
const KEY = 'rxvault.pending-invite';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
let memory: string | null = null;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // Blocked storage (private mode in some browsers).
  }
}

export async function setPendingInvite(token: string) {
  memory = token;
  try {
    storage()?.setItem(KEY, JSON.stringify({ token, at: Date.now() }));
  } catch {}
}

export async function getPendingInvite(): Promise<string | null> {
  if (memory) return memory;
  try {
    const raw = storage()?.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as { token?: unknown; at?: unknown }) : null;
    if (saved && typeof saved.token === 'string' && typeof saved.at === 'number' && Date.now() - saved.at < MAX_AGE_MS) {
      memory = saved.token;
    } else if (raw) {
      storage()?.removeItem(KEY);
    }
  } catch {
    memory = null;
  }
  return memory;
}

export async function clearPendingInvite() {
  memory = null;
  try {
    storage()?.removeItem(KEY);
  } catch {}
}
