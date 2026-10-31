/**
 * Getting pages onto the device: camera scan, photo library, PDF import.
 * Every image is normalized to a reasonably sized JPEG so uploads stay small and consistent.
 * All functions resolve to an empty array when the user cancels.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Linking, Platform } from 'react-native';
import DocumentScanner, { ResponseType, ScanDocumentResponseStatus } from 'react-native-document-scanner-plugin';

import { MAX_PAGE_BYTES } from '@/lib/api';
import type { LocalPage } from '@/lib/types';

const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.8;
const MAX_PHOTOS = 30;

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

export function openSystemSettings() {
  return Linking.openSettings().catch(() => {});
}

function toFileUri(pathOrUri: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(pathOrUri) ? pathOrUri : `file://${pathOrUri}`;
}

function fileSize(uri: string): number | undefined {
  try {
    return new File(uri).size ?? undefined;
  } catch {
    return undefined;
  }
}

/** Downscale (never upscale) to MAX_EDGE on the long side and re-encode as JPEG. */
async function normalizeImage(uri: string, width?: number, height?: number): Promise<LocalPage> {
  const ctx = ImageManipulator.manipulate(uri);
  try {
    let w = width;
    let h = height;
    if (!w || !h) {
      const probe = await ctx.renderAsync();
      w = probe.width;
      h = probe.height;
    }
    if (Math.max(w, h) > MAX_EDGE) {
      ctx.resize(w >= h ? { width: MAX_EDGE } : { height: MAX_EDGE });
    }
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    image.release();
    return { uri: saved.uri, mime: 'image/jpeg', size: fileSize(saved.uri) };
  } catch {
    throw new ScanError('This image could not be read. Please try a different photo.');
  } finally {
    ctx.release();
  }
}

async function normalizeAll(items: { uri: string; width?: number; height?: number }[]) {
  const pages: LocalPage[] = [];
  // Sequential on purpose: large photos decoded in parallel can exhaust memory on older phones.
  for (const it of items) pages.push(await normalizeImage(it.uri, it.width, it.height));
  return pages;
}

/** Native document scanner with edge detection and auto-crop. Handles camera permission itself. */
export async function scanDocument(): Promise<LocalPage[]> {
  if (Platform.OS === 'web') throw new ScanError('Scanning is only available in the mobile app.');
  let res;
  try {
    res = await DocumentScanner.scanDocument({
      croppedImageQuality: 90,
      responseType: ResponseType.ImageFilePath,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/permission|denied|authori[sz]/i.test(msg)) {
      throw new ScanError('Camera access is turned off. Allow camera access in Settings to scan documents.', true);
    }
    if (/cancel/i.test(msg)) return [];
    throw new ScanError('The scanner could not start. Please try again, or choose photos instead.');
  }
  if (res.status === ScanDocumentResponseStatus.Cancel || !res.scannedImages?.length) return [];
  return normalizeAll(res.scannedImages.map((p) => ({ uri: toFileUri(p) })));
}

/**
 * Pick one or more photos from the library, in the order the user selected them.
 * No permission prompt: iOS (PHPicker) and Android (system photo picker) run out of process and
 * only hand back what the user picked. Storage permissions are blocked in app.json on purpose.
 */
export async function pickPhotos(): Promise<LocalPage[]> {
  let res: ImagePicker.ImagePickerResult;
  try {
    res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS,
      orderedSelection: true,
      quality: 1,
      exif: false,
    });
  } catch {
    throw new ScanError('Your photos could not be opened. Please try again.');
  }
  if (res.canceled || !res.assets?.length) return [];
  return normalizeAll(res.assets.map((a) => ({ uri: a.uri, width: a.width || undefined, height: a.height || undefined })));
}

/** Import a single PDF file. It becomes one page of the document. */
export async function pickPdf(): Promise<LocalPage[]> {
  let res: DocumentPicker.DocumentPickerResult;
  try {
    res = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch {
    throw new ScanError('Your files could not be opened. Please try again.');
  }
  if (res.canceled || !res.assets?.length) return [];
  const asset = res.assets[0];
  const isPdf = asset.mimeType === 'application/pdf' || /\.pdf$/i.test(asset.name ?? '');
  if (!isPdf) throw new ScanError('That file is not a PDF. Please choose a PDF file.');
  const size = asset.size ?? fileSize(asset.uri);
  if (size != null && size > MAX_PAGE_BYTES) {
    throw new ScanError('This PDF is larger than 20 MB. Please choose a smaller file.');
  }
  return [{ uri: asset.uri, mime: 'application/pdf', size }];
}
