/**
 * Documents saved only on this phone (offered when the cloud quota is full).
 *
 * Storage: IndexedDB, not the Origin Private File System. OPFS writes from the main thread need
 * FileSystemFileHandle.createWritable(), which Safari only shipped in Safari/iOS 26; older iPhones
 * would need a Worker with createSyncAccessHandle. IndexedDB has worked in iPhone Safari for years
 * and falls under the same WebKit storage quota and eviction policy as OPFS.
 * Page bytes are stored as ArrayBuffers (plus their mime) rather than Blob objects: a buffer is
 * plain data in the database, which avoids WebKit's history of file-backed IndexedDB Blobs that
 * fail to read later. A fresh Blob is made from it on every read.
 *
 * These are the only copy: sign-out and clearCache leave them alone. Every read filters by the
 * signed-in user id so another account on the same browser never sees them.
 */
import * as Crypto from 'expo-crypto';

import { readBytes } from '@/lib/bytes';
import {
  LOCAL_ID_PREFIX,
  metaToDocument,
  metaToPages,
  pageKey,
  type LocalDocMeta,
} from '@/lib/local-doc-meta';
import { supabase } from '@/lib/supabase';
import type { DocDetails, DocType, Document, DocumentPage, LocalPage } from '@/lib/types';

const DB_NAME = 'rx-vault-local';
const DOCS = 'docs';
const PAGES = 'pages';
const MAX_PAGE_BYTES = 10 * 1024 * 1024;

export const localDocsSupported = true;

class LocalStorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      "This browser won't let Rx Vault save files on this phone. Private Browsing may be on — turn it off, or free up space in the cloud and try again.",
    );
    this.name = 'LocalStorageUnavailableError';
    (this as { cause?: unknown }).cause = cause;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new LocalStorageUnavailableError());
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (e) {
      reject(new LocalStorageUnavailableError(e));
      return;
    }
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DOCS, { keyPath: 'id' });
      req.result.createObjectStore(PAGES);
    };
    req.onsuccess = () => {
      // Another tab upgrading later: let it, and reopen next time.
      req.result.onversionchange = () => {
        req.result.close();
        dbPromise = null;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(new LocalStorageUnavailableError(req.error));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** Runs fn in one transaction over both stores; resolves with the last request's result once committed. */
async function run<T>(mode: IDBTransactionMode, fn: (docs: IDBObjectStore, pages: IDBObjectStore) => IDBRequest<T> | void) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction([DOCS, PAGES], mode);
    const req = fn(tx.objectStore(DOCS), tx.objectStore(PAGES));
    tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
    const fail = () => {
      const err = tx.error ?? req?.error;
      reject(
        err?.name === 'QuotaExceededError'
          ? new Error('There is not enough free space on this phone to save this document.')
          : new Error(err?.message || 'Could not access documents saved on this phone.'),
      );
    };
    tx.onerror = fail;
    tx.onabort = fail;
  });
}

async function userId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Not signed in');
  return id;
}

/** The signed-in user's local document, or an error as if it did not exist. */
async function getMeta(id: string): Promise<LocalDocMeta> {
  const [uid, meta] = await Promise.all([userId(), run<LocalDocMeta | undefined>('readonly', (docs) => docs.get(id))]);
  if (!meta || meta.user_id !== uid) throw new Error('This document is not saved on this phone.');
  return meta;
}

let persistAsked = false;

/** Saves a document only in this browser. Same input as createDocument (minus "Only me", which is moot here). */
export async function saveLocalDocument(input: {
  profileId: string;
  type: DocType;
  docDate: string;
  title?: string;
  doctor?: string;
  specialty?: string;
  hospital?: string;
  pages: LocalPage[];
}): Promise<Document> {
  if (!input.pages.length) throw new Error('Add at least one page');
  const uid = await userId();
  if (!persistAsked) {
    persistAsked = true;
    // Asks the browser not to evict us under storage pressure; Safari decides by heuristics (Home Screen apps fare best).
    void navigator.storage?.persist?.().catch(() => false);
  }
  // Read every page before opening the transaction: IndexedDB commits as soon as it has nothing queued.
  const bytes: ArrayBuffer[] = [];
  for (let i = 0; i < input.pages.length; i++) {
    const b = await readBytes(input.pages[i].uri);
    if (b.byteLength > MAX_PAGE_BYTES) throw new Error(`Page ${i + 1} is larger than 10 MB`);
    bytes.push(b);
  }
  const meta: LocalDocMeta = {
    id: LOCAL_ID_PREFIX + Crypto.randomUUID(),
    user_id: uid,
    profile_id: input.profileId,
    type: input.type,
    doc_date: input.docDate,
    title: input.title?.trim() || null,
    doctor: input.doctor?.trim() || null,
    specialty: input.specialty?.trim() || null,
    hospital: input.hospital?.trim() || null,
    pages: input.pages.map((p, i) => ({ mime: p.mime, size: bytes[i].byteLength })),
    created_at: new Date().toISOString(),
  };
  // One transaction: either the document and all its pages are saved, or nothing is.
  await run('readwrite', (docs, pages) => {
    bytes.forEach((b, i) => pages.put({ mime: meta.pages[i].mime, bytes: b }, pageKey(meta.id, i + 1)));
    docs.put(meta);
  });
  return metaToDocument(meta);
}

/** The signed-in user's local documents for a profile, in no particular order (see mergeDocs). */
export async function listLocalDocuments(profileId: string, type?: DocType): Promise<Document[]> {
  if (typeof indexedDB === 'undefined') return [];
  const [uid, all] = await Promise.all([userId(), run<LocalDocMeta[]>('readonly', (docs) => docs.getAll())]);
  return all
    .filter((m) => m.user_id === uid && m.profile_id === profileId && (!type || m.type === type))
    .map(metaToDocument);
}

export async function getLocalDocument(id: string): Promise<{ doc: Document; pages: DocumentPage[] }> {
  const meta = await getMeta(id);
  return { doc: metaToDocument(meta), pages: metaToPages(meta) };
}

export async function updateLocalDocument(id: string, patch: Partial<DocDetails>) {
  const meta = await getMeta(id);
  const { private: _ignored, ...rest } = patch;
  await run('readwrite', (docs) => {
    docs.put({ ...meta, ...rest });
  });
}

/** Deletes the document and its page files from this browser. */
export async function deleteLocalDocument(id: string) {
  const meta = await getMeta(id);
  await run('readwrite', (docs, pages) => {
    meta.pages.forEach((_, i) => pages.delete(pageKey(id, i + 1)));
    docs.delete(id);
  });
}

/** The stored file of a local page. */
export async function getLocalPage(page: DocumentPage): Promise<Blob> {
  await getMeta(page.document_id);
  const rec = await run<{ mime: string; bytes: ArrayBuffer } | undefined>('readonly', (_, pages) =>
    pages.get(page.storage_path),
  );
  if (!rec) throw new Error('This page is missing from this phone.');
  return new Blob([rec.bytes], { type: rec.mime });
}
