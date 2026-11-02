/** Web version of bytes.ts. Local pages are blob: (or data:) URLs created by scan.web.ts. */

/** Bytes of a local page, for upload. */
export async function readBytes(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error('This page could not be read. Please add it again.');
  return res.arrayBuffer();
}

/** Releases the memory held by blob: URLs of pages that are no longer needed. */
export function discardLocalFiles(uris: string[]) {
  for (const uri of uris) {
    if (uri.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(uri);
      } catch {
        // ignore
      }
    }
  }
}
