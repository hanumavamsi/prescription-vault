import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, type Theme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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

export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const theme = useMemo(() => navTheme(scheme), [scheme]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors[scheme].background }}>
      <SafeAreaProvider>
        <ThemeProvider value={theme}>
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

  useEffect(() => {
    if (!initializing) SplashScreen.hideAsync().catch(() => {});
  }, [initializing]);

  // An invite opened while signed out is resumed right after sign-in.
  useEffect(() => {
    if (!signedIn) return;
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
  }, [signedIn]);

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
        options={{ headerShown: true, title: 'Invitation', headerBackButtonDisplayMode: 'minimal' }}
      />
    </Stack>
  );
}
