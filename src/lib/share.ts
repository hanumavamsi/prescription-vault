/**
 * Sharing a document page and invite messages. Web: share.web.ts (Web Share API, clipboard, download).
 */
import { Directory, File, Paths } from 'expo-file-system';
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
  const safe = title.replace(/[\\/:*?"<>|\r\n\t.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Document';
  return total > 1 ? `${safe} - page ${page.page_no}.${ext}` : `${safe}.${ext}`;
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
