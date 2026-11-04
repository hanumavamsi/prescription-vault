/**
 * Google's own sign-in button plus One Tap (web only). Google draws the button inside an iframe,
 * so it cannot be disabled; while `disabled`, a transparent overlay catches taps instead.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { initGoogleIdentity, type GoogleCredential } from '@/lib/google-web.web';

/** GIS renders buttons between 200 and 400 px wide. */
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const HEIGHT = 44;

type Props = {
  onCredential(c: GoogleCredential): void;
  onError(message: string): void;
  /** Shown dimmed; taps call onDisabledPress instead of opening Google. */
  disabled?: boolean;
  onDisabledPress?(): void;
  /** Offer One Tap (and automatic sign-in for returning users). */
  oneTap?: boolean;
};

export function GoogleWebButton({ onCredential, onError, disabled, onDisabledPress, oneTap }: Props) {
  const scheme = useColorScheme();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const handlers = useRef({ onCredential, onError });
  useEffect(() => {
    handlers.current = { onCredential, onError };
  });

  // Draw (and redraw on resize or theme change) Google's button.
  useEffect(() => {
    const el = host.current;
    if (!el || !width) return;
    let live = true;
    initGoogleIdentity((c) => handlers.current.onCredential(c))
      .then((id) => {
        if (!live) return;
        el.replaceChildren();
        id.renderButton(el, {
          type: 'standard',
          theme: scheme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'center',
          width: Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))),
        });
      })
      .catch((e: unknown) => live && handlers.current.onError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [width, scheme]);

  useEffect(() => {
    if (!oneTap) return;
    let cancel: (() => void) | undefined;
    initGoogleIdentity((c) => handlers.current.onCredential(c))
      .then((id) => {
        id.prompt();
        cancel = () => id.cancel();
      })
      .catch(() => {}); // The button effect reports load errors.
    return () => cancel?.();
  }, [oneTap]);

  return (
    <View
      style={[styles.wrap, disabled && styles.dim]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <div ref={host} style={{ display: 'flex', justifyContent: 'center', minHeight: HEIGHT }} />
      {disabled && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDisabledPress}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ disabled: true }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', alignItems: 'center', minHeight: HEIGHT },
  dim: { opacity: 0.4 },
});
