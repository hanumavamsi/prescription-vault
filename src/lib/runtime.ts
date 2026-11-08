import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

/**
 * True inside the Expo Go app. Expo Go only bundles Expo's own native modules, so the document
 * scanner and Google Sign-In are unavailable there and must be loaded lazily.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Running in a browser (the web app / home-screen PWA). */
export const isWeb = Platform.OS === 'web';

/** Email + password sign-in against a local Supabase. Never available in release builds. */
export const devEmailLogin = __DEV__;

/** Google on the web uses a Supabase OAuth redirect, which must be enabled for the project first. */
export const googleWebEnabled = process.env.EXPO_PUBLIC_GOOGLE_WEB_ENABLED === 'true';

/**
 * Cloudflare Turnstile site key. When set, the web email-code form shows the widget and sends its
 * token with the code request (Supabase Auth → Bot and Abuse Protection must use the same widget).
 * shortcut: native sends no captcha token, so email codes fail there once captcha is enabled in
 * Supabase; add a WebView-based Turnstile when the native app ships.
 */
export const turnstileSiteKey = isWeb ? process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY?.trim() || undefined : undefined;

/**
 * Base URL invite links point to (the token is appended as `/<token>`).
 * Native: EXPO_PUBLIC_INVITE_BASE_URL, falling back to the app scheme.
 * Web: EXPO_PUBLIC_INVITE_BASE_URL when it is an http(s) URL, otherwise this site's own /invite.
 */
export function inviteBaseUrl(): string {
  if (!isWeb) return process.env.EXPO_PUBLIC_INVITE_BASE_URL ?? 'prescriptionvault://invite';
  const env = process.env.EXPO_PUBLIC_INVITE_BASE_URL?.trim();
  if (env && /^https?:\/\//i.test(env)) return env.replace(/\/+$/, '');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/invite`;
}

/** Length of emailed sign-in codes; must match the Supabase project's Email OTP length (6-10). */
export const otpLength = Math.min(10, Math.max(6, Number(process.env.EXPO_PUBLIC_OTP_LENGTH) || 6));
