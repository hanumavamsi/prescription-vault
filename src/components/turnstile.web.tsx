/**
 * Cloudflare Turnstile (web only). Managed mode: most visitors never see a challenge; the widget only
 * appears when Cloudflare wants an interaction. Tokens are single-use and expire after 5 minutes, so
 * the parent bumps `resetKey` after each use, and expiry clears the token until a fresh one arrives.
 *
 * Docs: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 */
import { useEffect, useRef } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { turnstileSiteKey } from '@/lib/runtime';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback(token: string): void;
      'expired-callback'(): void;
      'error-callback'(): void;
      theme?: 'light' | 'dark' | 'auto';
      appearance?: 'always' | 'execute' | 'interaction-only';
      action?: string;
    },
  ): string;
  reset(id: string): void;
  remove(id: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing')));
    s.onerror = () => {
      scriptPromise = null;
      s.remove();
      reject(new Error('Could not load the security check. Check your connection and reload the page.'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

type Props = {
  onToken(token: string | null): void;
  onError(message: string): void;
  /** Change to get a fresh token after the current one was used. */
  resetKey?: number;
};

export function Turnstile({ onToken, onError, resetKey }: Props) {
  const scheme = useColorScheme();
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const handlers = useRef({ onToken, onError });
  useEffect(() => {
    handlers.current = { onToken, onError };
  });

  useEffect(() => {
    const el = host.current;
    const sitekey = turnstileSiteKey;
    if (!el || !sitekey) return;
    let live = true;
    loadScript()
      .then((ts) => {
        if (!live) return;
        widget.current = ts.render(el, {
          sitekey,
          action: 'email-code',
          theme: scheme === 'dark' ? 'dark' : 'light',
          appearance: 'interaction-only',
          callback: (token) => handlers.current.onToken(token),
          'expired-callback': () => handlers.current.onToken(null),
          'error-callback': () => {
            handlers.current.onToken(null);
            handlers.current.onError('The security check failed. Reload the page and try again.');
          },
        });
      })
      .catch((e: unknown) => live && handlers.current.onError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
      handlers.current.onToken(null);
    };
  }, [scheme]);

  useEffect(() => {
    if (resetKey && widget.current) window.turnstile?.reset(widget.current);
  }, [resetKey]);

  return <div ref={host} style={{ display: 'flex', justifyContent: 'center' }} />;
}
