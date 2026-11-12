/**
 * Web version of cache.ts. Pages are downloaded with the user's session and shown from in-memory
 * blob: URLs. A blob: URL only works inside this tab, so a copied link opens nothing elsewhere
 * (a signed storage URL would work for anyone who has it). Nothing is written to browser storage.
 */
import { downloadPage } from '@/lib/api';
import { clearPreparedShares } from '@/lib/share';
import type { DocumentPage } from '@/lib/types';

/** Thrown when a page cannot be loaded (usually offline). */
export class PageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("This page couldn't be loaded. Check your internet connection and try again.");
    this.name = 'PageUnavailableError';
    (this as { cause?: unknown }).cause = cause;
  }
}

/** Keeps the last few pages so swiping back and forth doesn't re-download; older ones are freed.
 * shortcut: a doc with more than MAX_PAGES pages can't share an evicted page until it is re-shown; raise if that bites. */
const MAX_PAGES = 20;
const memo = new Map<string, string>();
/** Bumped by clearCache so in-flight downloads don't repopulate the memo after sign-out. */
let generation = 0;

/** blob: URL for a page. Throws PageUnavailableError when it cannot be downloaded (usually offline). */
export async function getCachedPageUri(page: DocumentPage): Promise<string> {
  const hit = memo.get(page.storage_path);
  if (hit) {
    // Re-insert so the map stays in least-recently-used order.
    memo.delete(page.storage_path);
    memo.set(page.storage_path, hit);
    return hit;
  }
  const gen = generation;
  let blob: Blob;
  try {
    blob = await downloadPage(page.storage_path);
  } catch (e) {
    throw new PageUnavailableError(e);
  }
  if (gen !== generation) throw new PageUnavailableError();
  const existing = memo.get(page.storage_path);
  if (existing) return existing; // a parallel call for the same page finished first
  const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: page.mime }));
  memo.set(page.storage_path, url);
  while (memo.size > MAX_PAGES) {
    const [oldest, old] = memo.entries().next().value as [string, string];
    memo.delete(oldest);
    URL.revokeObjectURL(old);
  }
  return url;
}

/** Frees every page and any page files fetched for sharing. Called on sign-out and from Settings. */
export async function clearCache(): Promise<void> {
  generation += 1;
  for (const url of memo.values()) URL.revokeObjectURL(url);
  memo.clear();
  clearPreparedShares();
}

/** Nothing is stored in the browser. */
export async function cacheSizeBytes(): Promise<number> {
  return 0;
}
