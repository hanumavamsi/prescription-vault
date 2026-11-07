/**
 * Web version of scan.ts: camera photo, photo library and PDF import through a hidden
 * <input type="file">. iPhone Safari offers the camera for `capture`, and converts HEIC to JPEG
 * for `accept="image/*"`. Images are normalized to a JPEG (max 1800px) on a canvas and returned
 * as blob: URLs. All functions resolve to an empty array when the user cancels.
 *
 * Call these straight from a tap handler (no await before them): browsers only open the file
 * picker during a user gesture.
 */
import { MAX_PAGE_BYTES } from '@/lib/api';
import type { LocalPage } from '@/lib/types';

// Tuned on a real handwritten Rx: ~150 KB per page, handwriting still readable when zoomed.
const MAX_EDGE = 1800;
const JPEG_QUALITY = 0.6;
const MAX_PHOTOS = 30;
/** How long to wait after the window regains focus before treating the picker as cancelled. */
const CANCEL_FALLBACK_MS = 1500;

/** Error with a message that is safe to show to the user as-is. */
export class ScanError extends Error {
  /** True when the fix is to grant a permission in system Settings. */
  readonly needsSettings: boolean;
  constructor(message: string, needsSettings = false) {
    super(message);
    this.name = 'ScanError';
    this.needsSettings = needsSettings;
  }
}

/** Browsers cannot open system settings. */
export function openSystemSettings(): Promise<void> {
  return Promise.resolve();
}

type ChooseOptions = { accept: string; multiple?: boolean; capture?: boolean };

/** Opens the browser file picker. Resolves with the chosen files, or [] on cancel. */
function chooseFiles({ accept, multiple, capture }: ChooseOptions): Promise<File[]> {
  if (typeof document === 'undefined') return Promise.resolve([]);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = !!multiple;
    if (capture) input.setAttribute('capture', 'environment');
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    Object.assign(input.style, { position: 'fixed', left: '-10000px', top: '0', opacity: '0' });

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(files);
    };
    const onFocus = () => {
      // Older browsers have no 'cancel' event. Focus comes back before 'change' on some, so wait.
      timer = setTimeout(() => finish(Array.from(input.files ?? [])), CANCEL_FALLBACK_MS);
    };

    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    if (!('oncancel' in input)) window.addEventListener('focus', onFocus);

    document.body.appendChild(input);
    input.click();
  });
}

function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = document.createElement('img');
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}

/**
 * Draw `source` downscaled (never upscaled) to MAX_EDGE on the long side and encode as a JPEG page.
 * Returns null when the browser couldn't draw or encode it.
 */
async function toJpegPage(source: CanvasImageSource, w: number, h: number): Promise<LocalPage | null> {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // JPEG has no transparency; paint white so transparent PNGs don't turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToJpeg(canvas);
  // Release the canvas memory right away; iOS Safari has a low total canvas memory limit.
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) return null;
  if (blob.size > MAX_PAGE_BYTES) {
    throw new ScanError('This photo is larger than 20 MB. Please choose a smaller photo.');
  }
  return { uri: URL.createObjectURL(blob), mime: 'image/jpeg', size: blob.size };
}

/** One page from the live camera preview (see components/web-camera). */
export async function captureVideoFrame(video: HTMLVideoElement): Promise<LocalPage> {
  const page = video.videoWidth && video.videoHeight ? await toJpegPage(video, video.videoWidth, video.videoHeight) : null;
  if (!page) throw new ScanError('The camera is not ready yet. Please try again.');
  return page;
}

/** Downscale (never upscale) to MAX_EDGE on the long side and re-encode as JPEG. */
async function normalizeImage(file: File): Promise<LocalPage> {
  let img: HTMLImageElement;
  try {
    // Browsers apply the photo's EXIF orientation when drawing an <img> to a canvas.
    img = await decodeImage(file);
  } catch {
    const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    throw new ScanError(
      heic
        ? 'This browser cannot open HEIC photos. Please choose a JPEG or PNG photo, or use Safari on iPhone.'
        : 'This image could not be read. Please try a different photo.',
    );
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const page = w && h ? await toJpegPage(img, w, h) : null;
  if (!page) throw new ScanError('This image could not be read. Please try a different photo.');
  return page;
}

async function normalizeAll(files: File[]) {
  const pages: LocalPage[] = [];
  try {
    // Sequential on purpose: large photos decoded in parallel can exhaust memory on phones.
    for (const f of files) pages.push(await normalizeImage(f));
  } catch (e) {
    for (const p of pages) URL.revokeObjectURL(p.uri);
    throw e;
  }
  return pages;
}

/** Camera photo. iPhone Safari opens the camera; desktop browsers open a file picker. */
export async function scanDocument(): Promise<LocalPage[]> {
  const files = await chooseFiles({ accept: 'image/*', capture: true });
  return normalizeAll(files.slice(0, 1));
}

/** Pick one or more photos, in the order the browser returns them. */
export async function pickPhotos(): Promise<LocalPage[]> {
  const files = await chooseFiles({ accept: 'image/*', multiple: true });
  return normalizeAll(files.slice(0, MAX_PHOTOS));
}

/** Import a single PDF file. It becomes one page of the document. */
export async function pickPdf(): Promise<LocalPage[]> {
  const [file] = await chooseFiles({ accept: 'application/pdf,.pdf' });
  if (!file) return [];
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) throw new ScanError('That file is not a PDF. Please choose a PDF file.');
  if (file.size > MAX_PAGE_BYTES) {
    throw new ScanError('This PDF is larger than 20 MB. Please choose a smaller file.');
  }
  // Re-wrap so the blob carries the right type even when the browser reported none.
  const blob = file.type === 'application/pdf' ? file : new Blob([file], { type: 'application/pdf' });
  return [{ uri: URL.createObjectURL(blob), mime: 'application/pdf', size: file.size }];
}
