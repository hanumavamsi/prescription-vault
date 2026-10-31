/**
 * Optional Face ID / fingerprint / passcode lock.
 * Locks on launch and when returning after more than 60 seconds in the background.
 * While enabled, the app is also hidden in the app switcher.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Icon, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';

const KEY = 'app-lock-enabled';
const GRACE_MS = 60_000;

type AppLockValue = {
  enabled: boolean;
  available: boolean;
  setEnabled(v: boolean): Promise<void>;
};

const AppLockContext = createContext<AppLockValue | null>(null);

async function authenticate(promptMessage: string) {
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return res.success;
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [enabled, setEnabledState] = useState(false);
  const [available, setAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [covered, setCovered] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const authInFlight = useRef(false);

  const checkAvailable = useCallback(async () => {
    try {
      const [hw, enrolled, level] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.getEnrolledLevelAsync(),
      ]);
      // A device passcode alone is enough: authenticateAsync falls back to it.
      setAvailable((hw && enrolled) || level !== LocalAuthentication.SecurityLevel.NONE);
    } catch {
      setAvailable(false);
    }
  }, []);

  // Load preference; lock on cold start if enabled.
  useEffect(() => {
    (async () => {
      let on = false;
      try {
        on = (await SecureStore.getItemAsync(KEY)) === '1';
      } catch {}
      await checkAvailable();
      setEnabledState(on);
      setLocked(on);
      setLoaded(true);
    })();
  }, [checkAvailable]);

  const unlock = useCallback(async () => {
    if (authInFlight.current) return;
    authInFlight.current = true;
    setAuthenticating(true);
    try {
      if (await authenticate('Unlock Rx Vault')) setLocked(false);
    } catch {
      // Stay locked; user can tap Unlock again.
    } finally {
      authInFlight.current = false;
      setAuthenticating(false);
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (!enabled) return;
      if (state === 'background') {
        backgroundedAt.current = Date.now();
        setCovered(true);
      } else if (state === 'inactive') {
        // App switcher on iOS. Ignore while our own Face ID prompt is up.
        if (!authInFlight.current) setCovered(true);
      } else if (state === 'active') {
        setCovered(false);
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (since != null && Date.now() - since > GRACE_MS) setLocked(true);
        checkAvailable();
      }
    });
    return () => sub.remove();
  }, [enabled, checkAvailable]);

  const showLock = loaded && enabled && locked && !!session;

  // Prompt automatically whenever the lock appears.
  useEffect(() => {
    if (!showLock || AppState.currentState !== 'active') return;
    // Deferred so the lock screen is drawn before the system prompt appears.
    const t = setTimeout(unlock, 300);
    return () => clearTimeout(t);
  }, [showLock, unlock]);

  const setEnabled = useCallback(
    async (v: boolean) => {
      if (v === enabled) return;
      if (v && !available) {
        throw new Error('Set up Face ID, fingerprint or a device passcode in your phone settings first.');
      }
      authInFlight.current = true;
      let ok = false;
      try {
        ok = await authenticate(v ? 'Turn on App lock' : 'Turn off App lock');
      } finally {
        authInFlight.current = false;
      }
      if (!ok) return;
      await SecureStore.setItemAsync(KEY, v ? '1' : '0');
      setEnabledState(v);
      setLocked(false);
    },
    [enabled, available],
  );

  const value = useMemo(() => ({ enabled, available, setEnabled }), [enabled, available, setEnabled]);

  return (
    <AppLockContext.Provider value={value}>
      {children}
      <Modal
        visible={showLock || (enabled && covered && !!session)}
        animationType="none"
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => {}}>
        <LockScreen showUnlock={showLock} busy={authenticating} onUnlock={unlock} />
      </Modal>
    </AppLockContext.Provider>
  );
}

function LockScreen({ showUnlock, busy, onUnlock }: { showUnlock: boolean; busy: boolean; onUnlock: () => void }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.lock, { backgroundColor: theme.background }]}>
      <View style={styles.center}>
        <Icon name="lock.fill" size={48} />
        <Text variant="title" accessibilityRole="header">
          Rx Vault
        </Text>
        {showUnlock && (
          <Text color="textSecondary" style={{ textAlign: 'center' }}>
            Your health records are locked.
          </Text>
        )}
      </View>
      {showUnlock && (
        <Button
          title="Unlock"
          icon="faceid"
          loading={busy}
          onPress={onUnlock}
          accessibilityHint="Uses Face ID, fingerprint or your device passcode"
          style={styles.button}
        />
      )}
    </SafeAreaView>
  );
}

export function useAppLock(): AppLockValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used inside <AppLockProvider>');
  return ctx;
}

const styles = StyleSheet.create({
  lock: { flex: 1, padding: Spacing.four, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  button: { marginBottom: Spacing.four },
});
