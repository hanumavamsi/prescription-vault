/**
 * Sharing a document page and invite messages. Web: share.web.ts (Web Share API, clipboard, download).
 */
import { Directory, File, Paths } from 'expo-file-system';
import { printToFileAsync } from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

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
  const safe = safeName(title);
  return total > 1 ? `${safe} - page ${page.page_no}.${ext}` : `${safe}.${ext}`;
}

/** "Blood test.pdf": file name for a whole document shared as one PDF. */
export function pdfFileName(title: string) {
  return `${safeName(title)}.pdf`;
}

function safeName(title: string) {
  return title.replace(/[\\/:*?"<>|\r\n\t.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Document';
}

/** Starts fetching a page so a later share can open the share sheet within the tap. Native: nothing to do. */
export function preparePageShare(_input: SharePageInput): void {}

/** Drops pages prepared for sharing. Native: share copies are removed by clearCache. */
export function clearPreparedShares(): void {}

/** Copies the cached page to a readable file name so the share sheet doesn't show a hash. */
function shareCopy(src: string, name: string) {
  try {
    const dir = new Directory(Paths.cache, 'share');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, name);
    new File(src).copySync(dest, { overwrite: true });
    return dest;
  } catch {
    return new File(src);
  }
}

/** Opens the system share sheet for one page. */
export async function sharePage({ uri, mime, fileName, title }: SharePageInput): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  const named = shareCopy(uri, fileName);
  await Sharing.shareAsync(named.uri, { mimeType: mime, dialogTitle: title });
}

/** Whether this platform can combine a document's photo pages into one PDF to share. */
export const canSharePdf = true;

// A4 at 72 PPI, the size expo-print measures pages in.
const A4 = { width: 595, height: 842 };

/**
 * Combines image pages (in order) into one A4 PDF, one image per sheet, and opens the share sheet.
 * Images are inlined as base64 because the iOS print renderer can't load local file URLs.
 */
export async function shareImagesAsPdf({
  images,
  fileName,
  title,
}: {
  /** Local files from getCachedPageUri. */
  images: { uri: string; mime: 'image/jpeg' | 'image/png' }[];
  /** Human file name including .pdf. */
  fileName: string;
  title: string;
}): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  const sheets: string[] = [];
  for (const img of images) {
    const data = await new File(img.uri).base64();
    sheets.push(`<div class="sheet"><img src="data:${img.mime};base64,${data}" /></div>`);
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>
    @page { margin: 0; size: ${A4.width}px ${A4.height}px; }
    html, body { margin: 0; padding: 0; }
    .sheet { width: ${A4.width}px; height: ${A4.height}px; display: flex; align-items: center; justify-content: center;
             page-break-after: always; break-after: page; overflow: hidden; }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
    img { max-width: 100%; max-height: 100%; object-fit: contain; }
  </style></head><body>${sheets.join('')}</body></html>`;

  const { uri } = await printToFileAsync({
    html,
    width: A4.width,
    height: A4.height,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  const named = shareCopy(uri, fileName);
  try {
    new File(uri).delete();
  } catch {
    // Left in the cache folder; the OS clears it eventually.
  }
  await Sharing.shareAsync(named.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
}

/** 'shared': share sheet opened; 'copied': message copied to the clipboard (web); 'dismissed': user cancelled. */
export type ShareTextResult = 'shared' | 'copied' | 'dismissed';

/** Shares an invite message (which contains `url`). Native: the system share sheet. */
export async function shareText(message: string, _url: string): Promise<ShareTextResult> {
  await Share.share({ message });
  return 'shared';
}

/** Copies text to the clipboard. Only supported on web; returns false on native. */
export async function copyText(_text: string): Promise<boolean> {
  return false;
}
