/**
 * Authentication: Sign in with Apple (iOS), Google and a one-time email code, backed by Supabase Auth.
 * On the web, Google is a Supabase OAuth redirect and Apple is not offered.
 * This is the only module besides api.ts that talks to supabase directly.
 */
import type * as GoogleModule from '@react-native-google-signin/google-signin';
import type { Session, User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { listProfiles, updateProfile } from '@/lib/api';
import { clearCache } from '@/lib/cache';
import { clearPendingInvite } from '@/lib/pending-invite';
import { googleWebEnabled, isExpoGo, isWeb, otpLength } from '@/lib/runtime';
import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  initializing: boolean;
  signInWithApple(): Promise<void>;
  /** Native: Google Sign-In SDK. Web: redirects to Google and back (the page reloads). */
  signInWithGoogle(): Promise<void>;
  /** Emails a sign-in code (otpLength digits), creating the account on first use. */
  requestEmailCode(email: string): Promise<void>;
  /** Signs in with the code from requestEmailCode. */
  verifyEmailCode(email: string, code: string): Promise<void>;
  /** Development only (see devEmailLogin). Signs in, creating the account on first use. */
  signInWithEmail(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

let googleConfigured = false;
/** Loaded lazily: the native module is missing in Expo Go and would crash at import time. */
function google(): typeof GoogleModule {
  if (isWeb) throw new Error('Google sign-in SDK is not used on the web.');
  if (isExpoGo) throw new Error('Google sign-in is not available in Expo Go.');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-google-signin/google-signin') as typeof GoogleModule;
}

function configureGoogle() {
  const { GoogleSignin } = google();
  if (googleConfigured) return GoogleSignin;
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error('Google sign-in is not set up yet. Please use another sign-in option.');
  }
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    scopes: ['email', 'profile'],
  });
  googleConfigured = true;
  return GoogleSignin;
}

function friendly(e: unknown, fallback: string): Error {
  const msg = e instanceof Error ? e.message : '';
  if (/network|fetch|internet|offline/i.test(msg)) {
    return new Error('No internet connection. Please check your connection and try again.');
  }
  return new Error(msg ? `${fallback} ${msg}` : fallback);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string) {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new Error('Please enter a valid email address.');
  return e;
}

/** Errors from the email-code endpoints, in plain words. */
function friendlyCode(e: unknown, fallback: string, verifying = false): Error {
  const msg = e instanceof Error ? e.message : '';
  const status = typeof e === 'object' && e !== null && 'status' in e ? (e as { status: unknown }).status : null;
  if (status === 429 || /rate limit|too many|security purposes|only request this after/i.test(msg)) {
    return new Error('Too many attempts, wait a minute and try again.');
  }
  if (verifying && /expired|invalid|otp/i.test(msg)) {
    return new Error('That code is wrong or has expired. Check the latest email or send a new code.');
  }
  if (!verifying && /invalid.*email|email.*invalid|validate email/i.test(msg)) {
    return new Error('Please enter a valid email address.');
  }
  if (/signups? not allowed|signup is disabled/i.test(msg)) {
    return new Error('New accounts are not open right now.');
  }
  return friendly(e, fallback);
}

/**
 * Apple only returns the user's name on the very first sign-in. Save it to auth metadata and,
 * if the profile name was derived from the (often private relay) email, to the profile too.
 */
async function saveAppleName(fullName: AppleAuthentication.AppleAuthenticationFullName | null, user: User) {
  if (!fullName) return;
  const name = [fullName.givenName, fullName.familyName].filter(Boolean).join(' ').trim();
  if (!name) return;
  try {
    await supabase.auth.updateUser({ data: { full_name: name } });
    const profiles = await listProfiles();
    const own = profiles.find((p) => p.role === 'self');
    const emailName = user.email?.split('@')[0] ?? '';
    if (own && (own.display_name === emailName || own.display_name === 'Me')) {
      await updateProfile(own.id, { display_name: name.slice(0, 80) });
    }
  } catch {
    // Non-fatal: the user can edit their name in Settings.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) setSession(data.session);
      })
      .catch(() => {
        // Corrupt stored session: treat as signed out.
      })
      .finally(() => {
        if (mounted) setInitializing(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!mounted) return;
      setSession(next);
      setInitializing(false);
      if (event === 'SIGNED_OUT') {
        // Covers expired sessions and account deletion as well as explicit sign out.
        clearCache().catch(() => {});
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithApple = useCallback(async () => {
    if (Platform.OS !== 'ios') throw new Error('Sign in with Apple is only available on iPhone.');
    const rawNonce = Crypto.randomUUID() + Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
    } catch (e) {
      if (isCode(e, 'ERR_REQUEST_CANCELED')) return;
      throw friendly(e, 'Sign in with Apple failed.');
    }
    if (!credential.identityToken) throw new Error('Sign in with Apple failed. Please try again.');
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) throw friendly(error, 'Sign in with Apple failed.');
    if (data.user) await saveAppleName(credential.fullName, data.user);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (isWeb) {
      if (!googleWebEnabled) throw new Error('Google sign-in is not set up yet. Please use another sign-in option.');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      // On success the browser is already navigating to Google; the session is picked up on return.
      if (error) throw friendly(error, 'Google sign-in failed.');
      return;
    }
    const GoogleSignin = configureGoogle();
    const { isErrorWithCode, statusCodes } = google();
    let idToken: string | null = null;
    try {
      if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const res = await GoogleSignin.signIn();
      if (res.type !== 'success') return; // cancelled
      idToken = res.data.idToken;
    } catch (e) {
      if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) {
        return;
      }
      if (isErrorWithCode(e) && e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error('Google Play Services is not available on this device.');
      }
      throw friendly(e, 'Google sign-in failed.');
    }
    if (!idToken) throw new Error('Google sign-in failed. Please try again.');
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) throw friendly(error, 'Google sign-in failed.');
  }, []);

  const requestEmailCode = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizeEmail(email),
      options: { shouldCreateUser: true },
    });
    if (error) throw friendlyCode(error, 'Could not send the code.');
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    const token = code.replace(/\D/g, '');
    if (token.length !== otpLength) throw new Error(`Enter the ${otpLength}-digit code from the email.`);
    const { error } = await supabase.auth.verifyOtp({ email: normalizeEmail(email), token, type: 'email' });
    if (error) throw friendlyCode(error, 'Could not verify the code.', true);
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!__DEV__) throw new Error('Email sign-in is only available in development.');
    const creds = { email: email.trim(), password };
    const res = await supabase.auth.signInWithPassword(creds);
    if (!res.error) return;
    if (!/invalid login credentials/i.test(res.error.message)) throw friendly(res.error, 'Sign-in failed.');
    const { data, error } = await supabase.auth.signUp(creds);
    if (error) throw friendly(error, 'Sign-up failed.');
    if (!data.session) throw new Error('Account created. Turn off email confirmation in Supabase to sign in.');
  }, []);

  const signOut = useCallback(async () => {
    await clearCache().catch(() => {});
    await clearPendingInvite();
    if (!isWeb) {
      try {
        const GoogleSignin = configureGoogle();
        if (GoogleSignin.hasPreviousSignIn()) await GoogleSignin.signOut();
      } catch {
        // Google not configured or never used.
      }
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Server unreachable: still drop the local session so the device is signed out.
      await supabase.auth.signOut({ scope: 'local' });
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,
      signInWithApple,
      signInWithGoogle,
      requestEmailCode,
      verifyEmailCode,
      signInWithEmail,
      signOut,
    }),
    [
      session,
      initializing,
      signInWithApple,
      signInWithGoogle,
      requestEmailCode,
      verifyEmailCode,
      signInWithEmail,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

function isCode(e: unknown, code: string) {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === code;
}
