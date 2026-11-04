import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  router,
  useSegments,
  type ErrorBoundaryProps,
  type Theme,
} from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { Platform, View, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button, EmptyState } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { AppLockProvider } from '@/lib/app-lock';
import { AuthProvider, useAuth } from '@/lib/auth';
import { clearPendingInvite, getPendingInvite } from '@/lib/pending-invite';

SplashScreen.preventAutoHideAsync().catch(() => {});

function navTheme(scheme: 'light' | 'dark'): Theme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const c = Colors[scheme];
  return {
    ...base,
    colors: {
      primary: c.tint,
      background: c.background,
      card: c.background,
      text: c.text,
      border: c.separator,
      notification: c.danger,
    },
  };
}

/**
 * Without this, a crash while rendering unmounts the whole app; on the web that leaves an empty
 * white page with no clue what went wrong. Show the error and a way out instead.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  // A full reload also recovers from a failed route chunk download on the web.
  const reload = () => (Platform.OS === 'web' ? window.location.reload() : void retry());
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: Colors[scheme].background }}>
      <EmptyState
        icon="exclamationmark.triangle"
        title="Something went wrong"
        message={error.message || 'The app hit an unexpected error.'}
        action={<Button title="Reload" variant="secondary" onPress={reload} />}
      />
    </View>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const theme = useMemo(() => navTheme(scheme), [scheme]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors[scheme].background }}>
      <SafeAreaProvider>
        <ThemeProvider value={theme}>
          {Platform.OS === 'web' && (
            <Head>
              <title>Rx Vault</title>
            </Head>
          )}
          <AuthProvider>
            <AppLockProvider>
              <RootNavigator />
            </AppLockProvider>
          </AuthProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { session, initializing } = useAuth();
  const signedIn = !!session;
  const segments = useSegments();
  // Web: wait until the auth guard has left the sign-in route. Pushing earlier races the guard's
  // redirect, which turns /invite/<token> into /?token=<token> and drops the invite.
  const settled = Platform.OS !== 'web' || segments[0] !== 'sign-in';

  useEffect(() => {
    if (!initializing) SplashScreen.hideAsync().catch(() => {});
  }, [initializing]);

  // An invite opened while signed out is resumed right after sign-in. On the web this also covers
  // the Google redirect: the page reloads, the session is read from the URL during initializing,
  // and the token comes back from localStorage.
  useEffect(() => {
    if (!signedIn || !settled) return;
    let cancelled = false;
    getPendingInvite().then((token) => {
      if (cancelled || !token) return;
      clearPendingInvite();
      // Let the auth guard settle on (app) first, then open the invite on top.
      setTimeout(() => router.push(('/invite/' + encodeURIComponent(token)) as never), 0);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, settled]);

  // Keep the splash screen up until the stored session has been read.
  if (initializing) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
      </Stack.Protected>
      {/* Reachable signed in or out; when signed out it stores the token and sends you to sign-in. */}
      <Stack.Screen
        name="invite/[token]"
        options={{
          headerShown: true,
          title: 'Invitation',
          headerBackButtonDisplayMode: 'minimal',
          ...(Platform.OS === 'web' && { headerTitleAlign: 'center' as const }),
        }}
      />
    </Stack>
  );
}
