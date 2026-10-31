import * as WebBrowser from 'expo-web-browser';

export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL;
export const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL;
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL;

/** Opens a legal / help page in an in-app browser. */
export function openLink(url: string | undefined) {
  if (url) WebBrowser.openBrowserAsync(url).catch(() => {});
}
