/** Native stub: Turnstile is web-only (see turnstile.web.tsx and turnstileSiteKey in runtime.ts). */
type Props = {
  onToken(token: string | null): void;
  onError(message: string): void;
  resetKey?: number;
};

export function Turnstile(_props: Props): null {
  return null;
}
