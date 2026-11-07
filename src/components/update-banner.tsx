/**
 * Web only: when the tab or home-screen app returns to the foreground, check whether a newer deploy
 * is live and offer a one-tap reload. An open SPA keeps running its old JS until a full reload.
 */
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Each export gives the entry bundle a new content hash, and index.html points at it.
const ENTRY = /\/_expo\/static\/js\/web\/entry-[0-9a-f]+\.js/;

export function entryBundle(html: string) {
  return html.match(ENTRY)?.[0] ?? null;
}

export function UpdateBanner() {
  const theme = useTheme();
  const { top } = useSafeAreaInsets();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // Null in `expo start` (unhashed dev bundle), so the check never runs there.
    const running = entryBundle(document.documentElement.outerHTML);
    if (!running) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/', { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : ''))
        .then((html) => {
          const live = entryBundle(html);
          if (live && live !== running) setStale(true);
        })
        .catch(() => {}); // offline: try again next time
    };
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);

  if (!stale) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { top: top + Spacing.two, backgroundColor: theme.backgroundElement, borderColor: theme.separator }]}>
      <Text variant="headline" style={{ flexShrink: 1 }}>
        New version available
      </Text>
      <Button title="Refresh" onPress={() => window.location.reload()} />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    alignSelf: 'center',
    width: '92%',
    maxWidth: 480,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingLeft: Spacing.four,
    paddingRight: Spacing.two,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
  },
});
