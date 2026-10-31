/**
 * Renders one document page from the on-device cache.
 * Images: expo-image, pinch-to-zoom on iOS (ScrollView zoom), "Open full screen" on Android.
 * PDFs: iOS WKWebView renders local PDFs natively. Android WebView cannot render PDFs, so we
 * hand the file to the system viewer (File.preview → ACTION_VIEW) with share-sheet fallback.
 */
import { Image } from 'expo-image';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Button, ErrorState, Icon, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCachedPageUri } from '@/lib/cache';
import type { DocumentPage } from '@/lib/types';

type Props = {
  page: DocumentPage;
  width: number;
  height: number;
  /** Optional label used for accessibility, e.g. "Page 2 of 3". */
  label?: string;
  /** Called once the page's local file is ready (for sharing). */
  onReady?: (uri: string) => void;
};

/** Opens a local file in the platform viewer; falls back to the share sheet. */
export async function openExternally(uri: string, mime: string, title?: string) {
  const file = new File(uri);
  try {
    if (await file.canPreview({ mimeType: mime })) {
      await file.preview({ mimeType: mime, title });
      return;
    }
  } catch {
    // fall through to share sheet
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: title });
  } else {
    throw new Error('No app on this phone can open this file.');
  }
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

  if (page.mime === 'application/pdf') {
    if (Platform.OS === 'ios') {
      const dir = uri.slice(0, uri.lastIndexOf('/') + 1);
      return (
        <View style={box} accessibilityLabel={label ? `${label}, PDF` : 'PDF'}>
          <WebView
            source={{ uri }}
            originWhitelist={['file://*', '*']}
            allowingReadAccessToURL={dir}
            allowFileAccess
            style={{ flex: 1, backgroundColor: theme.background }}
            startInLoadingState
            renderLoading={() => (
              <View style={[StyleSheet.absoluteFill, styles.center]}>
                <ActivityIndicator color={theme.text} size="large" />
              </View>
            )}
            onError={() => fail('This PDF could not be displayed.')}
          />
        </View>
      );
    }
    return (
      <View style={[box, styles.center]}>
        <PdfCard uri={uri} title={label} />
      </View>
    );
  }

  const image = (
    <Image
      source={{ uri }}
      style={{ width, height }}
      contentFit="contain"
      accessible
      accessibilityLabel={label ?? 'Document page'}
      onError={() => fail('This page could not be displayed.')}
      transition={150}
    />
  );

  if (Platform.OS === 'ios') {
    return (
      <ScrollView
        style={box}
        contentContainerStyle={{ width, height }}
        maximumZoomScale={4}
        minimumZoomScale={1}
        bouncesZoom
        centerContent
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}>
        {image}
      </ScrollView>
    );
  }

  return (
    <View style={box}>
      {image}
      <View style={styles.zoomButton}>
        <Button
          title="Open full screen"
          icon="arrow.up.left.and.arrow.down.right"
          variant="secondary"
          accessibilityHint="Opens the page in your phone's photo viewer to zoom"
          onPress={() => openExternally(uri, page.mime, label).catch(() => undefined)}
        />
      </View>
    </View>
  );
}

function PdfCard({ uri, title }: { uri: string; title?: string }) {
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      await openExternally(uri, 'application/pdf', title);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <Icon name="doc.richtext" size={48} color={theme.textSecondary} />
      <Text variant="title2" style={{ textAlign: 'center' }}>
        PDF document
      </Text>
      <Text color="textSecondary" style={{ textAlign: 'center' }}>
        Opens in your phone&apos;s PDF viewer.
      </Text>
      <Button title="Open PDF" icon="arrow.up.right.square" onPress={open} loading={busy} style={{ alignSelf: 'stretch' }} />
      {error && (
        <Text color="danger" style={{ textAlign: 'center' }}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  card: {
    margin: Spacing.four,
    padding: Spacing.four,
    borderRadius: Radius.large,
    alignItems: 'center',
    gap: Spacing.three,
    alignSelf: 'stretch',
  },
  zoomButton: { position: 'absolute', left: Spacing.three, right: Spacing.three, bottom: Spacing.three },
});
