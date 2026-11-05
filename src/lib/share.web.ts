/**
 * Web version of share.ts.
 * Pages: Web Share API with files when the browser supports it (iPhone Safari, Android Chrome),
 * otherwise a download. Invites: Web Share API, otherwise the clipboard.
 *
 * Browsers only allow navigator.share / clipboard writes shortly after a tap, so pages are
 * fetched ahead of time (preparePageShare) and the share call happens without a slow await first.
 */
import type { DocumentPage } from '@/lib/types';

export type SharePageInput = {
  /** Local file (native) or URL (web) of the page, from getCachedPageUri. */
  uri: string;
  mime: DocumentPage['mime'];
  /** Human file name including extension, e.g. "Blood test - page 2.pdf". */
  fileName: string;
  title: string;
};

/** "Blood test - page 2.pdf": a readable file name for a shared page. */
export function shareFileName(title: string, page: Pick<DocumentPage, 'mime' | 'page_no'>, total: number) {
  const ext = page.mime === 'application/pdf' ? 'pdf' : page.mime === 'image/png' ? 'png' : 'jpg';
  const safe = title.replace(/[\\/:*?"<>|\r\n\t.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Document';
  return total > 1 ? `${safe} - page ${page.page_no}.${ext}` : `${safe}.${ext}`;
}

/** Web shares or downloads one page at a time; combining pages into a PDF is native only. */
export const canSharePdf = false;

export function pdfFileName(title: string) {
  return `${title}.pdf`;
}

export async function shareImagesAsPdf(_input: {
  images: { uri: string; mime: 'image/jpeg' | 'image/png' }[];
  fileName: string;
  title: string;
}): Promise<void> {
  throw new Error('Sharing as PDF is only available in the mobile app.');
}

const MAX_PREPARED = 4;
/** Fetched pages keyed by file name + url, oldest first. */
const prepared = new Map<string, Promise<File>>();
let generation = 0;

function keyOf(input: SharePageInput) {
  return `${input.fileName}\n${input.uri}`;
}

async function fetchFile({ uri, mime, fileName }: SharePageInput): Promise<File> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error('This page could not be downloaded. Check your internet connection and try again.');
  const blob = await res.blob();
  return new File([blob], fileName, { type: mime });
}

function getFile(input: SharePageInput): Promise<File> {
  const key = keyOf(input);
  const hit = prepared.get(key);
  if (hit) return hit;
  const gen = generation;
  const p = fetchFile(input);
  p.then(
    () => {
      // Signed out while downloading: don't keep the file around.
      if (gen !== generation) prepared.delete(key);
    },
    () => prepared.delete(key),
  );
  prepared.set(key, p);
  while (prepared.size > MAX_PREPARED) {
    const oldest = prepared.keys().next().value;
    if (oldest === undefined) break;
    prepared.delete(oldest);
  }
  return p;
}

/** Starts fetching a page so a later share can open the share sheet within the tap. */
export function preparePageShare(input: SharePageInput): void {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return;
  getFile(input).catch(() => undefined);
}

/** Drops pages prepared for sharing (called on sign-out via clearCache). */
export function clearPreparedShares(): void {
  generation += 1;
  prepared.clear();
}

function isAbort(e: unknown) {
  return e instanceof Error && e.name === 'AbortError';
}

/** Saves the file through a temporary download link. */
function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before releasing the memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Opens the share sheet for one page, or downloads it when the browser cannot share files. */
export async function sharePage(input: SharePageInput): Promise<void> {
  const file = await getFile(input);
  const data: ShareData = { files: [file], title: input.title };
  if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare(data)) {
    try {
      await navigator.share(data);
      return;
    } catch (e) {
      if (isAbort(e)) return;
      // NotAllowedError (the tap expired while downloading) or a share failure: download instead.
    }
  }
  download(file);
}

/** 'shared': share sheet opened; 'copied': message copied to the clipboard; 'dismissed': user cancelled. */
export type ShareTextResult = 'shared' | 'copied' | 'dismissed';

/** Copies text to the clipboard. Returns false when the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    Object.assign(area.style, { position: 'fixed', left: '-10000px', top: '0', opacity: '0' });
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Shares an invite message (which contains `url`): the share sheet where available, else the clipboard.
 * Throws when neither works; screens also show the link so it can be copied by hand.
 */
export async function shareText(message: string, url: string): Promise<ShareTextResult> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text: message });
      return 'shared';
    } catch (e) {
      if (isAbort(e)) return 'dismissed';
      // NotAllowedError (the tap expired while creating the link): try the clipboard.
    }
  }
  if (await copyText(message)) return 'copied';
  throw new Error(`Your browser blocked sharing. Copy this link and send it yourself: ${url}`);
}
