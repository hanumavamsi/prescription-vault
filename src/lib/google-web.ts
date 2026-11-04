/** Native stub: Google Identity Services is web-only (see google-web.web.ts). Native uses the Google Sign-In SDK. */
export type GoogleCredential = { idToken: string; nonce: string };

export const googleIdentityAvailable = false;

export function googleWebSignOut() {}
