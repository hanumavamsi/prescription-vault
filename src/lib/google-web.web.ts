/**
 * Google Identity Services (GIS) for the web app: Google's own "Continue with Google" button and
 * One Tap. Google returns an ID token in the page (no redirect through Supabase), which is then
 * exchanged with supabase.auth.signInWithIdToken. Because the token is issued to this site's origin,
 * Google's consent screen names this site instead of the Supabase project URL.
 *
 * Docs: https://developers.google.com/identity/gsi/web/reference/js-reference
 */
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

type CredentialResponse = { credential?: string };
type ButtonOptions = {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
};
type GoogleId = {
  initialize(config: {
    client_id: string;
    callback: (res: CredentialResponse) => void;
    nonce?: string;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    context?: 'signin' | 'signup' | 'use';
    itp_support?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: ButtonOptions): void;
  prompt(): void;
  cancel(): void;
  disableAutoSelect(): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

export type GoogleCredential = { idToken: string; nonce: string };

/** True when the web client ID is configured, so the GIS button can replace the OAuth redirect. */
export const googleIdentityAvailable = !!CLIENT_ID;

let scriptPromise: Promise<GoogleId> | null = null;

function loadScript(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  scriptPromise ??= new Promise<GoogleId>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('GIS missing')));
    s.onerror = () => {
      scriptPromise = null;
      s.remove();
      reject(new Error('Could not load Google sign-in. Check your connection and try again.'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// GIS keeps a single global configuration, so the latest listener is swapped in rather than
// calling initialize() again for every mount.
let listener: ((c: GoogleCredential) => void) | null = null;
let ready: Promise<GoogleId> | null = null;

/**
 * Loads GIS and configures it once per page. The raw nonce stays here; Google embeds its SHA-256
 * in the ID token, and Supabase checks one against the other to block token replay.
 */
export function initGoogleIdentity(onCredential: (c: GoogleCredential) => void): Promise<GoogleId> {
  listener = onCredential;
  ready ??= (async () => {
    if (!CLIENT_ID) throw new Error('Google sign-in is not set up yet. Please use another sign-in option.');
    const id = await loadScript();
    const nonce = crypto.randomUUID();
    id.initialize({
      client_id: CLIENT_ID,
      nonce: await sha256Hex(nonce),
      callback: (res) => {
        if (res.credential) listener?.({ idToken: res.credential, nonce });
      },
      // Returning users who already approved the app are signed in by One Tap without a click.
      auto_select: true,
      cancel_on_tap_outside: true,
      context: 'signin',
      itp_support: true,
      use_fedcm_for_prompt: true,
    });
    return id;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** Stops One Tap from signing the user straight back in after they sign out. */
export function googleWebSignOut() {
  window.google?.accounts?.id?.disableAutoSelect();
}
