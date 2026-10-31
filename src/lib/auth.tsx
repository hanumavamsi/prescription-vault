/**
 * Authentication: Sign in with Apple (iOS) and Google, backed by Supabase Auth.
 * This is the only module besides api.ts that talks to supabase directly.
 */
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import type { Session, User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { listProfiles, updateProfile } from '@/lib/api';
import { clearCache } from '@/lib/cache';
import { clearPendingInvite } from '@/lib/pending-invite';
import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  initializing: boolean;
  signInWithApple(): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

let googleConfigured = false;
function configureGoogle() {
  if (googleConfigured) return;
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error('Google sign-in is not set up yet. Please use another sign-in option.');
  }
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    scopes: ['email', 'profile'],
  });
  googleConfigured = true;
}

function friendly(e: unknown, fallback: string): Error {
  const msg = e instanceof Error ? e.message : '';
  if (/network|fetch|internet|offline/i.test(msg)) {
    return new Error('No internet connection. Please check your connection and try again.');
  }
  return new Error(msg ? `${fallback} ${msg}` : fallback);
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
    configureGoogle();
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

  const signOut = useCallback(async () => {
    await clearCache().catch(() => {});
    await clearPendingInvite();
    try {
      configureGoogle();
      if (GoogleSignin.hasPreviousSignIn()) await GoogleSignin.signOut();
    } catch {
      // Google not configured or never used.
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
      signOut,
    }),
    [session, initializing, signInWithApple, signInWithGoogle, signOut],
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
