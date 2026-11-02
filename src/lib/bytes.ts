/** Reading and discarding local page files (scans, picked photos, imported PDFs). Web: bytes.web.ts. */
import { File } from 'expo-file-system';

/** Bytes of a local page file, for upload. */
export function readBytes(uri: string): Promise<ArrayBuffer> {
  return new File(uri).arrayBuffer();
}

/** Deletes temporary page files from the app cache. Best effort; the OS also clears the cache folder. */
export function discardLocalFiles(uris: string[]) {
  for (const uri of uris) {
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // ignore
    }
  }
}
