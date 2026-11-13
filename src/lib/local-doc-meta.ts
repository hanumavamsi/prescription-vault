/**
 * Pure helpers for documents saved only on this device (web, see local-docs.web.ts).
 * No browser APIs here so they can be unit tested.
 */
import type { DocType, Document, DocumentPage } from '@/lib/types';

/** Local document ids start with this, so any screen can tell them apart from cloud ids (UUIDs). */
export const LOCAL_ID_PREFIX = 'local-';

export function isLocalId(id: string) {
  return id.startsWith(LOCAL_ID_PREFIX);
}

/** What is stored per local document. Page bytes live in a separate store, keyed by pageKey(). */
export type LocalDocMeta = {
  id: string;
  /** The signed-in account that saved it; other accounts on the same browser never see it. */
  user_id: string;
  profile_id: string;
  type: DocType;
  doc_date: string;
  title: string | null;
  doctor: string | null;
  specialty: string | null;
  hospital: string | null;
  pages: { mime: DocumentPage['mime']; size: number }[];
  created_at: string;
};

export function pageKey(docId: string, pageNo: number) {
  return `${docId}/${pageNo}`;
}

export function metaToDocument(m: LocalDocMeta): Document {
  return {
    id: m.id,
    profile_id: m.profile_id,
    type: m.type,
    doc_date: m.doc_date,
    title: m.title,
    doctor: m.doctor,
    specialty: m.specialty,
    hospital: m.hospital,
    page_count: m.pages.length,
    private: false,
    created_by: m.user_id,
    created_at: m.created_at,
  };
}

export function metaToPages(m: LocalDocMeta): DocumentPage[] {
  return m.pages.map((p, i) => ({
    id: pageKey(m.id, i + 1),
    document_id: m.id,
    page_no: i + 1,
    storage_path: pageKey(m.id, i + 1),
    mime: p.mime,
    size_bytes: p.size,
  }));
}

/** Newest first by document date, then by when it was added (the order listDocuments uses). */
export function mergeDocs(cloud: Document[], local: Document[]): Document[] {
  if (!local.length) return cloud;
  return [...cloud, ...local].sort((a, b) =>
    a.doc_date !== b.doc_date ? (a.doc_date < b.doc_date ? 1 : -1) : a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
}
