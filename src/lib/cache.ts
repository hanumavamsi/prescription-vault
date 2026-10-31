/**
 * On-device cache of document pages so recently viewed records open instantly and work offline.
 *
 * Location: Paths.cache/page-cache.
 *   expo-file-system (SDK 58) has no API to set NSURLIsExcludedFromBackupKey, so a folder under
 *   Paths.document would be swept into iCloud / Android Auto Backup. The OS cache directory is
 *   excluded from both by the platform, which matters more for medical files than persistence.
 *   The trade-off: the OS may purge it under storage pressure; we treat that as a cache miss.
 *
 * Encryption at rest: files live inside the app sandbox and are protected by the OS — iOS Data
 * Protection (default class: complete until first unlock) and Android file-based encryption.
 * We do not add our own file encryption on top (see SPEC "Offline").
 *
 * Eviction: LRU, at most MAX_FILES pages or MAX_BYTES total, tracked in a small JSON index.
 */
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { signedPageUrl } from '@/lib/api';
import type { DocumentPage } from '@/lib/types';

const MAX_FILES = 50;
const MAX_BYTES = 200 * 1024 * 1024;
const INDEX_NAME = 'index.json';
/** Cache sub-folders other modules write page copies to (share sheet copies, pickers, image manipulator). */
const TRANSIENT_DIRS = ['share', 'ImagePicker', 'ImageManipulator', 'DocumentPicker'];

type Entry = { lastUsed: number; size: number };
type Index = Record<string, Entry>;

/** Thrown when a page is not cached and cannot be downloaded (usually offline). */
export class PageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("This page isn't saved on this phone yet. Connect to the internet and try again.");
    this.name = 'PageUnavailableError';
    (this as { cause?: unknown }).cause = cause;
  }
}

function cacheDir() {
  return new Directory(Paths.cache, 'page-cache');
}

function ensureDir() {
  const dir = cacheDir();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

let index: Index | null = null;
/** Bumped by clearCache so in-flight downloads don't resurrect cleared files. */
let generation = 0;
const inflight = new Map<string, Promise<string>>();
let writeChain: Promise<void> = Promise.resolve();

let loading: Promise<Index> | null = null;

function loadIndex(): Promise<Index> {
  if (index) return Promise.resolve(index);
  loading ??= readIndex().finally(() => {
    loading = null;
  });
  return loading;
}

async function readIndex(): Promise<Index> {
  const dir = ensureDir();
  const file = new File(dir, INDEX_NAME);
  let parsed: Index = {};
  if (file.exists) {
    try {
      const raw = JSON.parse(await file.text());
      if (raw && typeof raw === 'object') parsed = raw as Index;
    } catch {
      parsed = {};
    }
  }
  // Reconcile with disk: drop entries the OS purged, delete files we don't know about.
  const onDisk = new Set<string>();
  for (const item of dir.list()) {
    if (!(item instanceof File) || item.name === INDEX_NAME) continue;
    if (parsed[item.name]) onDisk.add(item.name);
    else safeDelete(item);
  }
  for (const name of Object.keys(parsed)) if (!onDisk.has(name)) delete parsed[name];
  index = parsed;
  return index;
}

function persistIndex() {
  const snapshot = JSON.stringify(index ?? {});
  writeChain = writeChain
    .then(async () => {
      const dir = ensureDir();
      await new File(dir, INDEX_NAME).write(snapshot);
    })
    .catch(() => {
      // Index is advisory; it is rebuilt from disk on next launch.
    });
  return writeChain;
}

function safeDelete(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // ignore
  }
}

function extFor(mime: DocumentPage['mime']) {
  return mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
}

async function fileNameFor(page: DocumentPage) {
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, page.storage_path);
  return `${hash}.${extFor(page.mime)}`;
}

function evict(idx: Index, keep: string) {
  const names = Object.keys(idx).sort((a, b) => idx[a].lastUsed - idx[b].lastUsed);
  let count = names.length;
  let total = names.reduce((sum, n) => sum + idx[n].size, 0);
  const dir = cacheDir();
  for (const name of names) {
    if (count <= MAX_FILES && total <= MAX_BYTES) break;
    if (name === keep) continue;
    safeDelete(new File(dir, name));
    total -= idx[name].size;
    count -= 1;
    delete idx[name];
  }
}

async function fetchPage(page: DocumentPage, name: string): Promise<string> {
  const idx = await loadIndex();
  const dir = ensureDir();
  const file = new File(dir, name);

  if (file.exists && idx[name]) {
    idx[name].lastUsed = Date.now();
    persistIndex();
    return file.uri;
  }

  const gen = generation;
  let downloaded: File;
  try {
    const url = await signedPageUrl(page.storage_path);
    downloaded = await File.downloadFileAsync(url, file, { idempotent: true });
  } catch (e) {
    safeDelete(file); // Android may leave a partial file behind.
    throw new PageUnavailableError(e);
  }

  if (gen !== generation) {
    // Cache was cleared (e.g. sign-out) while downloading; don't keep the file.
    safeDelete(downloaded);
    throw new PageUnavailableError();
  }

  let size = page.size_bytes ?? 0;
  try {
    size = downloaded.size || size;
  } catch {
    // keep fallback
  }
  idx[name] = { lastUsed: Date.now(), size };
  evict(idx, name);
  persistIndex();
  return downloaded.uri;
}

/** Local file uri for a page, downloading it once if needed. Throws PageUnavailableError when offline and not cached. */
export async function getCachedPageUri(page: DocumentPage): Promise<string> {
  const name = await fileNameFor(page);
  const pending = inflight.get(name);
  if (pending) return pending;
  const p = fetchPage(page, name).finally(() => inflight.delete(name));
  inflight.set(name, p);
  return p;
}

/** Removes every cached page. Called on sign-out and from Settings. */
export async function clearCache(): Promise<void> {
  generation += 1;
  index = {};
  inflight.clear();
  await writeChain;
  // Also drop temporary copies made while sharing, picking, scanning or resizing pages:
  // they are health records too and must not outlive the session.
  for (const dir of [cacheDir(), ...TRANSIENT_DIRS.map((name) => new Directory(Paths.cache, name))]) {
    try {
      if (dir.exists) dir.delete();
    } catch {
      // ignore
    }
  }
}

export async function cacheSizeBytes(): Promise<number> {
  try {
    const idx = await loadIndex();
    return Object.values(idx).reduce((sum, e) => sum + e.size, 0);
  } catch {
    return 0;
  }
}
