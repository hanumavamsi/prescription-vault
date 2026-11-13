/**
 * Native stub of local-docs.web.ts. Saving documents only on the device is a web feature
 * (offered when the cloud quota is full); the native app has none.
 */
import type { DocDetails, DocType, Document, DocumentPage, LocalPage } from '@/lib/types';

export const localDocsSupported = false;

function unsupported(): never {
  throw new Error('Saving on this phone is only available in the web app.');
}

export async function saveLocalDocument(_input: {
  profileId: string;
  type: DocType;
  docDate: string;
  title?: string;
  doctor?: string;
  specialty?: string;
  hospital?: string;
  pages: LocalPage[];
}): Promise<Document> {
  unsupported();
}

export async function listLocalDocuments(_profileId: string, _type?: DocType): Promise<Document[]> {
  return [];
}

export async function getLocalDocument(_id: string): Promise<{ doc: Document; pages: DocumentPage[] }> {
  unsupported();
}

export async function updateLocalDocument(_id: string, _patch: Partial<DocDetails>): Promise<void> {
  unsupported();
}

export async function deleteLocalDocument(_id: string): Promise<void> {
  unsupported();
}

export async function getLocalPage(_page: DocumentPage): Promise<Blob> {
  unsupported();
}
