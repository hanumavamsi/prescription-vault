/** Native stub: Google's web button is web-only (see google-web-button.web.tsx). */
import type { GoogleCredential } from '@/lib/google-web';

type Props = {
  onCredential(c: GoogleCredential): void;
  onError(message: string): void;
  disabled?: boolean;
  onDisabledPress?(): void;
  oneTap?: boolean;
};

export function GoogleWebButton(_props: Props): null {
  return null;
}
