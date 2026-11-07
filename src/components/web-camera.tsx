/** Native stub: the live multi-page camera is web-only (see web-camera.web.tsx). Native uses the document scanner. */
import type { LocalPage } from '@/lib/types';

export const webCameraSupported = false;

type Props = {
  existingCount: number;
  maxPages: number;
  onDone(pages: LocalPage[]): void;
  onCancel(): void;
  onUnavailable(message: string, permissionDenied: boolean): void;
};

export function WebCamera(_props: Props): null {
  return null;
}
