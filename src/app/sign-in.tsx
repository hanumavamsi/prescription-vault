import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Icon, Text } from '@/components/ui';
import { HitSize, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { PRIVACY_URL, TERMS_URL, openLink } from '@/lib/links';

export default function SignInScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const { signInWithApple, signInWithGoogle } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  async function run(kind: 'apple' | 'google') {
    if (!agreed) {
      setError('Please agree to the terms below to continue.');
      return;
    }
    if (busy) return;
    setError(null);
    setBusy(kind);
    try {
      await (kind === 'apple' ? signInWithApple() : signInWithGoogle());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.backgroundElement }]}>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <View style={styles.hero}>
          <View style={[styles.mark, { backgroundColor: theme.tint }]}>
            <Icon name="cross.case.fill" size={44} color={theme.onTint} />
          </View>
          <Text variant="largeTitle" accessibilityRole="header" style={styles.center}>
            Rx Vault
          </Text>
          <Text variant="title2" color="textSecondary" style={[styles.center, styles.promise]}>
            Every prescription and medical report for your whole family, safe in one place.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="I agree to the Terms and Privacy Policy and consent to storing my and my family's health records"
            onPress={() => {
              setAgreed((v) => !v);
              setError(null);
            }}
            style={styles.consent}>
            <Icon
              name={agreed ? 'checkmark.square.fill' : 'square'}
              size={28}
              color={agreed ? theme.text : theme.textSecondary}
            />
            <Text variant="callout" style={styles.flex}>
              I agree to the{' '}
              <Text
                variant="callout"
                style={styles.link}
                accessibilityRole="link"
                onPress={() => openLink(TERMS_URL)}>
                Terms
              </Text>{' '}
              and{' '}
              <Text
                variant="callout"
                style={styles.link}
                accessibilityRole="link"
                onPress={() => openLink(PRIVACY_URL)}>
                Privacy Policy
              </Text>{' '}
              and consent to storing my and my family&apos;s health records.
            </Text>
          </Pressable>

          {error && (
            <Text color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.center}>
              {error}
            </Text>
          )}

          {appleAvailable && (
            <View
              style={{ opacity: agreed && !busy ? 1 : 0.4 }}
              pointerEvents={busy ? 'none' : 'auto'}
              accessibilityState={{ disabled: !agreed }}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={
                  scheme === 'dark'
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={Radius.medium}
                style={styles.apple}
                onPress={() => run('apple')}
              />
            </View>
          )}

          <Button
            title="Continue with Google"
            variant={appleAvailable ? 'secondary' : 'primary'}
            loading={busy === 'google'}
            disabled={!agreed || busy === 'apple'}
            onPress={() => run('google')}
          />

          <Text variant="footnote" color="textSecondary" style={styles.center}>
            Your records are stored securely in India and only shared with people you approve.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'space-between',
    padding: Spacing.four,
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingTop: Spacing.six },
  mark: {
    width: 88,
    height: 88,
    borderRadius: Radius.large + 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  promise: { fontWeight: '400', maxWidth: 360 },
  center: { textAlign: 'center' },
  actions: { gap: Spacing.three },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, minHeight: HitSize, paddingVertical: Spacing.one },
  link: { textDecorationLine: 'underline', fontWeight: '600' },
  apple: { height: HitSize + 4, width: '100%' },
});
