/**
 * Web-only multi-page camera. Keeps a live camera preview open so pages can be shot one after
 * another (shutter, shutter, shutter, Done), instead of the browser's one-photo-per-tap camera.
 *
 * Uses getUserMedia, which needs HTTPS (or localhost) and a camera permission prompt. If the
 * camera can't be opened, `onUnavailable` lets the caller fall back to the one-shot file input.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { discardLocalFiles } from '@/lib/bytes';
import { captureVideoFrame, ScanError } from '@/lib/scan';
import type { LocalPage } from '@/lib/types';

/** Whether this browser can show a live camera preview at all. */
export const webCameraSupported =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';

type Props = {
  /** Pages already in the document; the camera stops at maxPages in total. */
  existingCount: number;
  maxPages: number;
  /** Called with the new pages when the user taps Done (possibly empty). */
  onDone(pages: LocalPage[]): void;
  /** Called with the pages taken so far when the user closes without keeping them. */
  onCancel(): void;
  /** The camera could not be opened (no permission, no camera); `message` explains why. */
  onUnavailable(message: string, permissionDenied: boolean): void;
};

function cameraError(e: unknown): { message: string; denied: boolean } {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      message:
        'Camera access is blocked. To scan pages one after another, allow the camera for this site (on iPhone: aA in the address bar, then Website Settings, then Camera).',
      denied: true,
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { message: 'No camera was found on this device.', denied: false };
  }
  if (name === 'NotReadableError') {
    return { message: 'The camera is being used by another app. Close it and try again.', denied: false };
  }
  return { message: 'The camera could not be opened.', denied: false };
}

export function WebCamera({ existingCount, maxPages, onDone, onCancel, onUnavailable }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [shots, setShots] = useState<LocalPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handlers = useRef({ onUnavailable });
  useEffect(() => {
    handlers.current = { onUnavailable };
  });

  // Open the back camera and stop every track on close.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let live = true;
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } },
      })
      .then(async (s) => {
        if (!live) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const el = video.current;
        if (!el) return;
        el.srcObject = s;
        try {
          await el.play();
        } catch {
          // Autoplay of a muted inline video is allowed; ignore the rare interruption error.
        }
        if (live) setReady(true);
      })
      .catch((e: unknown) => {
        if (!live) return;
        const { message, denied } = cameraError(e);
        handlers.current.onUnavailable(message, denied);
      });
    return () => {
      live = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const remaining = maxPages - existingCount - shots.length;

  async function shoot() {
    const el = video.current;
    if (!el || busy || !ready || remaining <= 0) return;
    setBusy(true);
    setError(null);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    try {
      const page = await captureVideoFrame(el);
      setShots((prev) => [...prev, page]);
    } catch (e) {
      setError(e instanceof ScanError ? e.message : 'Could not take the photo. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function removeLast() {
    setShots((prev) => {
      const last = prev[prev.length - 1];
      if (last) discardLocalFiles([last.uri]);
      return prev.slice(0, -1);
    });
  }

  function close() {
    discardLocalFiles(shots.map((s) => s.uri));
    onCancel();
  }

  const count = shots.length;
  const total = existingCount + count;

  return (
    <View style={styles.root} accessibilityViewIsModal>
      <video
        ref={video}
        playsInline
        muted
        autoPlay
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
      />
      {flash && <View style={[StyleSheet.absoluteFill, styles.flash]} pointerEvents="none" />}

      {!ready && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.light}>Opening camera…</Text>
        </View>
      )}

      {/* Top bar: close and page count */}
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={count ? `Cancel and discard ${count} ${count === 1 ? 'page' : 'pages'}` : 'Close camera'}
          onPress={close}
          hitSlop={8}
          style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
          <Icon name="xmark" size={20} color="#fff" />
        </Pressable>
        <View style={styles.counter} accessibilityLiveRegion="polite">
          <Text style={[styles.light, styles.bold]}>
            {count === 0 ? 'Take a photo of page ' + (existingCount + 1) : `${count} ${count === 1 ? 'page' : 'pages'} taken`}
          </Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Bottom: thumbnails, then undo · shutter · done */}
      <View style={styles.bottom}>
        {error && (
          <Text style={[styles.light, styles.center]} accessibilityRole="alert">
            {error}
          </Text>
        )}
        {remaining <= 0 && (
          <Text style={[styles.light, styles.center]}>
            {`A document can have up to ${maxPages} pages. Tap Done to continue.`}
          </Text>
        )}
        {count > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {shots.map((s, i) => (
              <View key={s.uri} style={styles.thumbWrap}>
                <Image source={{ uri: s.uri }} style={styles.thumb} accessibilityLabel={`Page ${existingCount + i + 1}`} />
                <Text style={[styles.light, styles.thumbNo]}>{existingCount + i + 1}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retake the last page"
            disabled={!count || busy}
            onPress={removeLast}
            style={({ pressed }) => [styles.sideButton, !count && styles.hidden, pressed && styles.pressed]}>
            <Icon name="arrow.uturn.backward" size={20} color="#fff" />
            <Text style={[styles.light, styles.small]}>Retake</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Take photo of page ${total + 1}`}
            disabled={!ready || busy || remaining <= 0}
            onPress={shoot}
            style={({ pressed }) => [
              styles.shutter,
              (!ready || remaining <= 0) && styles.dim,
              pressed && { transform: [{ scale: 0.92 }] },
            ]}>
            <View style={styles.shutterInner} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Done, keep ${count} ${count === 1 ? 'page' : 'pages'}`}
            disabled={!count || busy}
            onPress={() => onDone(shots)}
            style={({ pressed }) => [styles.doneButton, !count && styles.hidden, pressed && styles.pressed]}>
            <Text style={[styles.dark, styles.bold]}>Done</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // Fixed over the whole page, above the navigation header.
    position: 'fixed' as 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    backgroundColor: '#000',
  },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three, textAlign: 'center' },
  flash: { backgroundColor: '#fff', opacity: 0.6 },
  light: { color: '#fff' },
  dark: { color: '#000' },
  bold: { fontWeight: '600' },
  small: { fontSize: 13 },
  pressed: { opacity: 0.6 },
  hidden: { opacity: 0 },
  dim: { opacity: 0.4 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: 'max(12px, env(safe-area-inset-top))' as unknown as number,
    paddingBottom: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  counter: { flex: 1, alignItems: 'center' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: 'max(20px, env(safe-area-inset-bottom))' as unknown as number,
    paddingHorizontal: Spacing.three,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  strip: { gap: Spacing.two, paddingHorizontal: Spacing.one },
  thumbWrap: { alignItems: 'center', gap: 2 },
  thumb: { width: 48, height: 64, borderRadius: Radius.small, backgroundColor: '#222' },
  thumbNo: { fontSize: 11 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sideButton: { width: 72, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 2 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  doneButton: {
    width: 72,
    minHeight: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
});
