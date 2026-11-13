import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { DocDetailsFields, PrivateSwitch, type DetailsValue } from '@/components/doc-details-fields';
import { WebCamera, webCameraSupported } from '@/components/web-camera';
import {
  Avatar,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Loading,
  Screen,
  Section,
  Segmented,
  Text,
  todayISO,
  type IconName,
} from '@/components/ui';
import { HitSize, Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { createDocument, listProfiles, QuotaExceededError } from '@/lib/api';
import { discardLocalFiles } from '@/lib/bytes';
import { confirm } from '@/lib/confirm';
import { localDocsSupported, saveLocalDocument } from '@/lib/local-docs';
import { openSystemSettings, pickPdf, pickPhotos, scanDocument, ScanError } from '@/lib/scan';
import type { DocType, LocalPage } from '@/lib/types';

type Source = 'scan' | 'photos' | 'pdf';

const MAX_PAGES = 30;

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Returns an error message, or null when the date is a valid YYYY-MM-DD not in the future. */
function validateDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Enter the date as YYYY-MM-DD, for example ' + todayISO() + '.';
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return 'That date does not exist.';
  if (y < 1900) return 'Please check the year.';
  if (value > todayISO()) return 'The date cannot be in the future.';
  return null;
}

/** Removes temporary page files (scans, resized photos, imported PDF copies; blob URLs on web). */
function deleteLocalPages(pages: LocalPage[]) {
  discardLocalFiles(pages.map((p) => p.uri));
}

export default function AddDocumentScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ profileId?: string }>();
  const profiles = useQuery(listProfiles);

  const [pages, setPages] = useState<LocalPage[]>([]);
  const [picking, setPicking] = useState<Source | null>(null);
  const [chosenProfileId, setChosenProfileId] = useState<string | null>(null);
  const [type, setType] = useState<DocType>('prescription');
  const [date, setDate] = useState(todayISO);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState<DetailsValue>({ doctor: '', specialty: '', hospital: '' });
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** Web: the live camera is open for shooting pages one after another. */
  const [cameraOpen, setCameraOpen] = useState(false);
  /** Web: the live camera failed once (blocked, missing); use the browser's one-shot camera instead. */
  const [cameraFallback, setCameraFallback] = useState(false);

  const writable = useMemo(
    () => (profiles.data ?? []).filter((p) => p.role === 'self' || p.role === 'managed'),
    [profiles.data],
  );
  const profileId =
    chosenProfileId ??
    writable.find((p) => p.id === params.profileId)?.id ??
    writable.find((p) => p.role === 'self')?.id ??
    writable[0]?.id ??
    null;

  const isPdf = pages.length === 1 && pages[0].mime === 'application/pdf';
  const dateError = validateDate(date);
  const canSave = pages.length > 0 && !!profileId && !dateError && !saving;

  const unsaved = (pages.length > 0 && !done) || saving;

  // Ask before throwing away picked pages; block closing entirely while uploading.
  usePreventRemove(unsaved, () => {
    if (saving) return;
    void confirm({
      title: 'Discard this document?',
      message: 'The pages you added will not be saved.',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      deleteLocalPages(pages);
      // Lifting the prevention closes the screen via the effect below.
      setDone(true);
    });
  });

  // Web: the browser's back button, reload and tab close bypass usePreventRemove; ask the browser to warn.
  useEffect(() => {
    if (Platform.OS !== 'web' || !unsaved || typeof window === 'undefined') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  useEffect(() => {
    if (done && !saving) router.back();
    // Only on the transition to done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  /** Web with a live camera: open it so several pages can be shot in a row. */
  const useLiveCamera = Platform.OS === 'web' && webCameraSupported && !cameraFallback;

  function addPages(picked: LocalPage[]) {
    setPages((prev) => {
      const base = prev.length === 1 && prev[0].mime === 'application/pdf' ? [] : prev;
      const next = [...base, ...picked];
      if (next.length > MAX_PAGES) {
        setError(`A document can have up to ${MAX_PAGES} pages. Only the first ${MAX_PAGES} were kept.`);
      }
      return next.slice(0, MAX_PAGES);
    });
  }

  async function pick(source: Source) {
    if (picking || saving) return;
    if (source === 'scan' && useLiveCamera) {
      setError(null);
      setCameraOpen(true);
      return;
    }
    setPicking(source);
    setError(null);
    try {
      const fn = source === 'scan' ? scanDocument : source === 'photos' ? pickPhotos : pickPdf;
      const picked = await fn();
      if (!picked.length) return;
      if (source === 'pdf') {
        setPages(picked.slice(0, 1));
        return;
      }
      addPages(picked);
    } catch (e) {
      if (e instanceof ScanError && e.needsSettings) {
        void confirm({
          title: 'Permission needed',
          message: e.message,
          confirmText: 'Open Settings',
          cancelText: 'Not now',
        }).then((open) => {
          if (open) void openSystemSettings();
        });
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setPicking(null);
    }
  }

  function addMore() {
    if (Platform.OS === 'web') {
      // No action sheet on web. With a live camera, keep scanning; otherwise the browser's photo
      // picker, which also offers the camera on phones and must open straight from this tap.
      void pick(useLiveCamera ? 'scan' : 'photos');
      return;
    }
    Alert.alert('Add more pages', undefined, [
      { text: 'Scan with camera', onPress: () => void pick('scan') },
      { text: 'Choose photos', onPress: () => void pick('photos') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function removePage(index: number) {
    deleteLocalPages(pages.slice(index, index + 1));
    setPages((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    if (!canSave || !profileId) {
      if (dateError) setError(dateError);
      return;
    }
    setSaving(true);
    setError(null);
    setProgress({ done: 0, total: pages.length });
    const input = { profileId, type, docDate: date, title: title.trim() || undefined, ...details, pages };
    try {
      try {
        await createDocument({ ...input, private: isPrivate }, (d, total) => setProgress({ done: d, total }));
      } catch (e) {
        if (!(e instanceof QuotaExceededError) || !localDocsSupported) throw e;
        const mb = (n: number) => Math.round(n / (1024 * 1024));
        const onPhone = await confirm({
          title: 'Cloud storage full',
          message: `You've used ${mb(e.used)} of ${mb(e.quota)} MB. Save this document on this phone instead? It will only be on this device and browser, isn't backed up or shared with family, and iPhone may delete it if you don't open Rx Vault for a while (adding it to the Home Screen helps).`,
          confirmText: 'Save on this phone',
          cancelText: 'Cancel',
        });
        const localError = onPhone
          ? await saveLocalDocument(input).then(
              () => null,
              (le: unknown) => (le instanceof Error ? le.message : String(le)),
            )
          : null;
        if (!onPhone || localError) {
          setSaving(false);
          setProgress(null);
          if (localError) setError(`Could not save on this phone: ${localError}`);
          return;
        }
      }
      deleteLocalPages(pages);
      setSaving(false);
      setDone(true);
    } catch (e) {
      setSaving(false);
      setProgress(null);
      setError(
        e instanceof Error
          ? `Could not save: ${e.message}. Check your internet connection and try again.`
          : 'Could not save. Please try again.',
      );
    }
  }

  const progressLabel =
    progress && progress.total > 1
      ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
      : 'Uploading…';

  const header = (
    <Stack.Screen
      options={{
        title: pages.length ? 'New document' : 'Add document',
        headerLeft: () => (
          <HeaderButton label="Cancel" onPress={() => router.back()} disabled={saving} />
        ),
        headerRight: () =>
          pages.length ? (
            saving ? (
              <ActivityIndicator color={theme.text} accessibilityLabel={progressLabel} />
            ) : (
              <HeaderButton label="Save" bold onPress={save} disabled={!canSave} />
            )
          ) : null,
      }}
    />
  );

  const camera = cameraOpen && (
    <WebCamera
      existingCount={pages.length === 1 && isPdf ? 0 : pages.length}
      maxPages={MAX_PAGES}
      onDone={(shots) => {
        setCameraOpen(false);
        if (shots.length) addPages(shots);
      }}
      onCancel={() => setCameraOpen(false)}
      onUnavailable={(message, denied) => {
        setCameraOpen(false);
        setCameraFallback(true);
        setError(
          denied
            ? `${message} For now, tap Scan with camera again to take one photo at a time.`
            : `${message} Tap Scan with camera again to take one photo at a time.`,
        );
      }}
    />
  );

  if (profiles.loading && !profiles.data) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }
  if (profiles.error && !profiles.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {header}
        <ErrorState message={profiles.error} onRetry={profiles.refresh} />
      </View>
    );
  }
  if (!writable.length) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {header}
        <EmptyState
          icon="person.crop.circle.badge.exclamationmark"
          title="No one to add for"
          message="Your profile is still being set up. Please close this screen and try again in a moment."
          action={<Button title="Try again" variant="secondary" onPress={profiles.refresh} />}
        />
      </View>
    );
  }

  // ---------------------------------------------------------------- step 1: choose source
  if (!pages.length) {
    return (
      <Screen>
        {header}
        {camera}
        <Text color="textSecondary" style={styles.intro}>
          How would you like to add the prescription or report?
        </Text>
        <View style={styles.choices}>
          <SourceChoice
            icon="doc.viewfinder"
            title="Scan with camera"
            subtitle={
              Platform.OS === 'web'
                ? 'Best for paper. Take a clear photo of each page.'
                : 'Best for paper. Edges are cropped for you.'
            }
            loading={picking === 'scan'}
            disabled={!!picking}
            onPress={() => pick('scan')}
          />
          <SourceChoice
            icon="photo.on.rectangle"
            title="Choose photos"
            subtitle="Pick one or more pictures you already took."
            loading={picking === 'photos'}
            disabled={!!picking}
            onPress={() => pick('photos')}
          />
          <SourceChoice
            icon="doc.richtext"
            title="Import PDF"
            subtitle="A lab report or file someone sent you."
            loading={picking === 'pdf'}
            disabled={!!picking}
            onPress={() => pick('pdf')}
          />
        </View>
        {error && <InlineError message={error} />}
      </Screen>
    );
  }

  // ---------------------------------------------------------------- step 2: details
  return (
    <Screen automaticallyAdjustKeyboardInsets>
      {header}
      {camera}

      <View style={{ gap: Spacing.two }}>
        <Text variant="footnote" color="textSecondary" style={styles.label}>
          {isPdf ? 'PDF' : `${pages.length} ${pages.length === 1 ? 'PAGE' : 'PAGES'}`}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {pages.map((page, i) => (
            <PageThumb
              key={page.uri + i}
              page={page}
              index={i}
              disabled={saving}
              onRemove={() => removePage(i)}
            />
          ))}
          {!isPdf && pages.length < MAX_PAGES && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add more pages"
              disabled={saving || !!picking}
              onPress={addMore}
              style={({ pressed }) => [
                styles.thumb,
                styles.addTile,
                { borderColor: theme.textTertiary, opacity: saving ? 0.4 : pressed ? 0.6 : 1 },
              ]}>
              {picking ? (
                <ActivityIndicator color={theme.text} />
              ) : (
                <>
                  <Icon name="plus" size={26} />
                  <Text variant="footnote" style={{ textAlign: 'center' }}>
                    Add more
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </ScrollView>
      </View>

      <View style={{ gap: Spacing.two }}>
        <Text variant="footnote" color="textSecondary" style={styles.label}>
          WHOSE DOCUMENT IS THIS?
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.people}>
          {writable.map((p) => {
            const selected = p.id === profileId;
            const name = p.role === 'self' ? 'Me' : p.display_name;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="radio"
                accessibilityLabel={p.role === 'self' ? `Me, ${p.display_name}` : p.display_name}
                accessibilityState={{ selected, disabled: saving }}
                disabled={saving}
                onPress={() => setChosenProfileId(p.id)}
                style={({ pressed }) => [
                  styles.person,
                  {
                    backgroundColor: selected ? theme.backgroundElement : 'transparent',
                    borderColor: selected ? theme.tint : 'transparent',
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                <Avatar name={p.display_name} size={52} />
                <Text
                  variant="callout"
                  numberOfLines={1}
                  style={[styles.personName, { fontWeight: selected ? '600' : '400' }]}>
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <Section title="Type">
        <View style={styles.padded}>
          <Segmented<DocType>
            value={type}
            onChange={setType}
            options={[
              { value: 'prescription', label: 'Prescription' },
              { value: 'report', label: 'Report' },
            ]}
          />
        </View>
      </Section>

      <Section title="Date" footer={dateError ?? 'The date written on the document.'}>
        <View style={[styles.padded, styles.chips]}>
          <Chip label="Today" selected={date === todayISO()} onPress={() => setDate(todayISO())} disabled={saving} />
          <Chip
            label="Yesterday"
            selected={date === isoDaysAgo(1)}
            onPress={() => setDate(isoDaysAgo(1))}
            disabled={saving}
          />
        </View>
        <View style={[styles.separator, { backgroundColor: theme.separator }]} />
        <Field
          label="Date (YYYY-MM-DD)"
          value={date}
          onChangeText={(t) => setDate(t.replace(/[^\d-]/g, '').slice(0, 10))}
          placeholder={todayISO()}
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
          autoCorrect={false}
          maxLength={10}
          editable={!saving}
          accessibilityHint="Year, month and day separated by dashes"
        />
      </Section>

      <Section title="Title (optional)">
        <Field
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder={type === 'prescription' ? 'e.g. Fever follow-up' : 'e.g. CBC blood test'}
          maxLength={120}
          returnKeyType="done"
          editable={!saving}
        />
      </Section>

      <DocDetailsFields value={details} onChange={setDetails} editable={!saving} />

      <PrivateSwitch value={isPrivate} onChange={setIsPrivate} editable={!saving} />

      {error && <InlineError message={error} />}

      <Button
        title={saving ? progressLabel : 'Save'}
        icon={saving ? undefined : 'checkmark'}
        onPress={save}
        disabled={!canSave}
        style={saving ? { opacity: 0.7 } : undefined}
        accessibilityHint="Uploads the pages and saves the document"
      />
      {saving && <ActivityIndicator color={theme.text} accessibilityLabel={progressLabel} />}
    </Screen>
  );
}

// ------------------------------------------------------------------ local components

function HeaderButton({
  label,
  onPress,
  bold,
  disabled,
}: {
  label: string;
  onPress: () => void;
  bold?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={12}
      style={({ pressed }) => [styles.headerButton, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
      <Text variant={bold ? 'headline' : 'body'}>{label}</Text>
    </Pressable>
  );
}

function SourceChoice({
  icon,
  title,
  subtitle,
  onPress,
  loading,
  disabled,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          opacity: disabled && !loading ? 0.5 : 1,
        },
      ]}>
      <View style={[styles.choiceIcon, { backgroundColor: theme.backgroundSelected }]}>
        {loading ? <ActivityIndicator color={theme.text} /> : <Icon name={icon} size={30} />}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="title2">{title}</Text>
        <Text color="textSecondary">{subtitle}</Text>
      </View>
      <Icon name="chevron.right" size={16} color={theme.textTertiary} />
    </Pressable>
  );
}

function PageThumb({
  page,
  index,
  onRemove,
  disabled,
}: {
  page: LocalPage;
  index: number;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const pdf = page.mime === 'application/pdf';
  return (
    <View style={styles.thumbWrap}>
      <View
        accessible
        accessibilityLabel={pdf ? 'PDF document' : `Page ${index + 1}`}
        style={[styles.thumb, { backgroundColor: theme.backgroundElement, borderColor: theme.separator }]}>
        {pdf ? (
          <View style={styles.pdfTile}>
            <Icon name="doc.richtext" size={34} />
            <Text variant="caption" color="textSecondary">
              PDF
            </Text>
          </View>
        ) : (
          <Image source={{ uri: page.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        )}
      </View>
      {!pdf && (
        <Text variant="caption" color="textSecondary" style={{ textAlign: 'center' }}>
          {index + 1}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pdf ? 'Remove PDF' : `Remove page ${index + 1}`}
        onPress={onRemove}
        disabled={disabled}
        hitSlop={10}
        style={({ pressed }) => [
          styles.remove,
          { backgroundColor: theme.tint, borderColor: theme.background, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        ]}>
        <Icon name="xmark" size={13} color={theme.onTint} />
      </Pressable>
    </View>
  );
}

function InlineError({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.error, { backgroundColor: theme.backgroundElement }]}>
      <Icon name="exclamationmark.triangle" size={20} color={theme.danger} />
      <Text color="danger" style={{ flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: Spacing.one },
  choices: { gap: Spacing.three },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.large,
    minHeight: 96,
  },
  choiceIcon: {
    width: 60,
    height: 60,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { paddingHorizontal: Spacing.three },
  strip: { gap: Spacing.three, paddingHorizontal: Spacing.one, paddingTop: Spacing.two },
  thumbWrap: { gap: Spacing.one },
  thumb: {
    width: 84,
    height: 112,
    borderRadius: Radius.small,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  addTile: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  pdfTile: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  remove: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  people: { gap: Spacing.two, paddingHorizontal: Spacing.one },
  person: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: 2,
    minWidth: 84,
    maxWidth: 120,
    minHeight: HitSize,
  },
  personName: { maxWidth: 104 },
  padded: { padding: Spacing.three },
  chips: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  error: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
    padding: Spacing.three,
    borderRadius: Radius.medium,
  },
  // The web header has no side inset of its own.
  headerButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Platform.OS === 'web' ? Spacing.three : Spacing.one },
});
