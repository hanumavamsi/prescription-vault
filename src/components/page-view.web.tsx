/**
 * Web version of page-view.tsx. Renders one document page from its signed URL.
 * Images: expo-image, contained; click/tap opens the full-size image in a new tab for zooming.
 * PDFs: the browser's own PDF viewer in an <iframe>, with an "Open PDF" button because
 * iPhone Safari shows only the first page of a PDF inside a frame.
 */
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button, ErrorState } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCachedPageUri } from '@/lib/cache';
import type { DocumentPage } from '@/lib/types';

type Props = {
  page: DocumentPage;
  width: number;
  height: number;
  /** Optional label used for accessibility, e.g. "Page 2 of 3". */
  label?: string;
  /** Called once the page's URL is ready (for sharing). */
  onReady?: (uri: string) => void;
};

/** Opens a page in a new browser tab, where the browser's viewer can zoom, print or save it. */
export async function openExternally(uri: string, _mime: string, _title?: string) {
  // With 'noopener' the return value is always null, so it says nothing about success.
  window.open(uri, '_blank', 'noopener');
}

export function PageView({ page, width, height, label, onReady }: Props) {
  const theme = useTheme();
  const [attempt, setAttempt] = useState(0);
  const key = `${page.id}:${page.storage_path}:${attempt}`;
  // Results are tagged with the key they belong to, so a new page/retry shows loading without resetting state in the effect.
  const [result, setResult] = useState<{ key: string; uri?: string; error?: string } | null>(null);
  const current = result?.key === key ? result : null;
  const uri = current?.uri ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    let cancelled = false;
    getCachedPageUri(page)
      .then((u) => {
        if (cancelled) return;
        setResult({ key, uri: u });
        onReady?.(u);
      })
      .catch((e: unknown) => {
        if (!cancelled) setResult({ key, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
    // page/onReady intentionally excluded: key captures page identity; callers pass inline callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const fail = useCallback((message: string) => setResult({ key, error: message }), [key]);

  const box = { width, height, backgroundColor: theme.background };

  if (error) {
    return (
      <View style={[box, styles.center]}>
        <ErrorState message={error} onRetry={retry} />
      </View>
    );
  }

  if (!uri) {
    return (
      <View style={[box, styles.center]} accessibilityLabel={`Loading ${label ?? 'page'}`}>
        <ActivityIndicator color={theme.text} size="large" />
      </View>
    );
  }

  const open = () => {
    openExternally(uri, page.mime, label).catch(() => undefined);
  };

  if (page.mime === 'application/pdf') {
    return (
      <View style={box} accessibilityLabel={label ? `${label}, PDF` : 'PDF'}>
        <View style={{ flex: 1 }}>
          <iframe
            src={uri}
            title={label ?? 'PDF document'}
            style={{ width: '100%', height: '100%', border: 0, display: 'block', backgroundColor: theme.background }}
          />
        </View>
        <View style={styles.bar}>
          <Button
            title="Open PDF"
            icon="arrow.up.right.square"
            variant="secondary"
            accessibilityHint="Opens the whole PDF in a new tab to read, zoom or save it"
            onPress={open}
          />
        </View>
      </View>
    );
  }

  return (
    <Pressable
      style={box}
      onPress={open}
      accessibilityRole="imagebutton"
      accessibilityLabel={label ?? 'Document page'}
      accessibilityHint="Opens the page at full size in a new tab">
      <Image
        source={{ uri }}
        style={{ width, height }}
        contentFit="contain"
        onError={() => fail('This page could not be displayed.')}
        transition={150}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  bar: { padding: Spacing.three },
});
