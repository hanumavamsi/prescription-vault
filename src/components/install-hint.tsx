/**
 * Web only: a card that teaches phone users to add Rx Vault to the Home Screen. Hidden when already
 * opened from the Home Screen, on desktop, and once dismissed.
 */
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button, Icon, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const KEY = 'rx-install-hint-dismissed';

type InstallPrompt = Event & { prompt: () => Promise<void> };

export function installPlatform(ua: string, touchPoints: number, standalone: boolean): 'ios' | 'android' | null {
  if (standalone) return null;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return null;
}

function detect() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    if (window.localStorage.getItem(KEY)) return null;
  } catch {}
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return installPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0, standalone);
}

export function InstallHint({ signedIn = false }: { signedIn?: boolean }) {
  const theme = useTheme();
  const [platform, setPlatform] = useState(detect); // SPA (web output "single"): no server render to match
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    // Android Chrome offers its own install dialog.
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    if (Platform.OS === 'web') window.addEventListener('beforeinstallprompt', onPrompt);
    return () => {
      if (Platform.OS === 'web') window.removeEventListener('beforeinstallprompt', onPrompt);
    };
  }, []);

  if (!platform) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {}
    setPlatform(null);
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.background, borderColor: theme.separator }]}>
      <View style={styles.head}>
        <Text variant="headline" style={{ flex: 1 }}>
          Add Rx Vault to your Home Screen
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={dismiss} hitSlop={12}>
          <Icon name="xmark" size={18} color={theme.textSecondary} />
        </Pressable>
      </View>
      <Text color="textSecondary">
        {platform === 'ios' ? (
          <>
            Opens like an app, full screen. In Safari tap <Text style={styles.bold}>⋯</Text> or{' '}
            <Text style={styles.bold}>Share</Text>, then <Text style={styles.bold}>Add to Home Screen</Text>.
          </>
        ) : (
          <>
            Opens like an app, full screen. In Chrome tap <Text style={styles.bold}>⋮</Text>, then{' '}
            <Text style={styles.bold}>Add to Home screen</Text>.
          </>
        )}
        {signedIn && platform === 'ios' && ' You’ll sign in once more there.'}
      </Text>
      {prompt && (
        <Button
          title="Install"
          icon="plus"
          onPress={() => void prompt.prompt().finally(() => setPrompt(null))}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  bold: { fontWeight: '600' },
});
