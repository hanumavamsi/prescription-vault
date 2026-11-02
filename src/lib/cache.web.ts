/**
 * Web version of cache.ts. Browsers get no offline page cache: pages are shown straight from
 * short-lived signed URLs, memoized for this tab session so swiping back and forth doesn't
 * re-sign every page. Nothing is written to browser storage.
 */
import { signedPageUrl } from '@/lib/api';
import { clearPreparedShares } from '@/lib/share';
import type { DocumentPage } from '@/lib/types';

/** Signed URLs live for an hour; reuse them for 50 minutes so a page never loads an expired one. */
const URL_TTL_SECONDS = 3600;
const REUSE_MS = 50 * 60 * 1000;

/** Thrown when a page cannot be loaded (usually offline). */
export class PageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("This page couldn't be loaded. Check your internet connection and try again.");
    this.name = 'PageUnavailableError';
    (this as { cause?: unknown }).cause = cause;
  }
}

const memo = new Map<string, { url: string; until: number }>();
/** Bumped by clearCache so in-flight requests don't repopulate the memo after sign-out. */
let generation = 0;

/** URL for a page. Throws PageUnavailableError when it cannot be signed (usually offline). */
export async function getCachedPageUri(page: DocumentPage): Promise<string> {
  const hit = memo.get(page.storage_path);
  if (hit && hit.until > Date.now()) return hit.url;
  const gen = generation;
  let url: string;
  try {
    url = await signedPageUrl(page.storage_path, URL_TTL_SECONDS);
  } catch (e) {
    throw new PageUnavailableError(e);
  }
  if (gen !== generation) throw new PageUnavailableError();
  memo.set(page.storage_path, { url, until: Date.now() + REUSE_MS });
  return url;
}

/** Forgets every page URL and any page files fetched for sharing. Called on sign-out and from Settings. */
export async function clearCache(): Promise<void> {
  generation += 1;
  memo.clear();
  clearPreparedShares();
}

/** Nothing is stored in the browser. */
export async function cacheSizeBytes(): Promise<number> {
  return 0;
}
