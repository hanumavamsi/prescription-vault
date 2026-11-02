import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ListViewToken,
} from 'react-native';

import { PageView } from '@/components/page-view';
import {
  Button,
  ErrorState,
  Field,
  Icon,
  Loading,
  Screen,
  Section,
  Segmented,
  Text,
  docTypeLabel,
  formatDate,
  todayISO,
  type IconName,
} from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { deleteDocument, getDocument, getProfile, updateDocument } from '@/lib/api';
import { getCachedPageUri } from '@/lib/cache';
import { confirm, showMessage } from '@/lib/confirm';
import { preparePageShare, shareFileName, sharePage } from '@/lib/share';
import type { DocType, Document, DocumentPage } from '@/lib/types';

export default function DocumentViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [current, setCurrent] = useState(0);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const uris = useRef(new Map<string, string>());
  const list = useRef<FlatList<DocumentPage>>(null);

  const { data, error, loading, refresh, setData } = useQuery(async () => {
    const { doc, pages } = await getDocument(id);
    // If the role can't be determined, fall back to read-only.
    const profile = await getProfile(doc.profile_id).catch(() => null);
    return { doc, pages, profile };
  }, [id]);

  const onViewable = useCallback(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setCurrent(first.index);
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && s.width === width && s.height === height ? s : { width, height }));
  }, []);

  if (loading && !data) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <Loading />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <Screen>
          <ErrorState message={error ?? 'Could not load this document.'} onRetry={refresh} />
        </Screen>
      </>
    );
  }

  const { doc, pages, profile } = data;
  const canEdit = profile?.role === 'self' || profile?.role === 'managed';
  const title = doc.title?.trim() || docTypeLabel[doc.type];
  const page = pages[Math.min(current, pages.length - 1)];
  const pageLabel = (i: number) => `Page ${i + 1} of ${pages.length}`;

  const share = async () => {
    if (!page) return;
    setSharing(true);
    try {
      const src = uris.current.get(page.id) ?? (await getCachedPageUri(page));
      await sharePage({ uri: src, mime: page.mime, title, fileName: shareFileName(title, page, pages.length) });
    } catch (e) {
      showMessage('Could not share', e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

  // Desktop browsers can't swipe between pages, so the web shows Previous / Next buttons.
  const showPager = Platform.OS === 'web' && pages.length > 1;
  const goTo = (index: number) => {
    const i = Math.max(0, Math.min(pages.length - 1, index));
    list.current?.scrollToIndex({ index: i, animated: true });
    setCurrent(i);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerTitle: () => (
            <View style={styles.headerTitle} accessible accessibilityRole="header" accessibilityLabel={`${title}, ${formatDate(doc.doc_date)}`}>
              <Text variant="headline" numberOfLines={1}>
                {title}
              </Text>
              <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                {formatDate(doc.doc_date)}
              </Text>
            </View>
          ),
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderButton icon="square.and.arrow.up" label="Share this page" onPress={share} disabled={sharing || !page} />
              {canEdit && <HeaderButton icon="pencil" label="Edit details" onPress={() => setEditing(true)} />}
            </View>
          ),
        }}
      />
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {pages.length === 0 ? (
          <Screen>
            <ErrorState message="This document has no pages." onRetry={refresh} />
          </Screen>
        ) : (
          <View style={{ flex: 1 }} onLayout={onLayout}>
            {size && (
              <FlatList
                ref={list}
                data={pages}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={(p) => p.id}
                onViewableItemsChanged={onViewable}
                viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
                getItemLayout={(_, index) => ({ length: size.width, offset: size.width * index, index })}
                windowSize={3}
                initialNumToRender={1}
                renderItem={({ item, index }) => (
                  <PageView
                    page={item}
                    width={size.width}
                    height={size.height}
                    label={pages.length > 1 ? pageLabel(index) : title}
                    onReady={(uri) => {
                      uris.current.set(item.id, uri);
                      preparePageShare({
                        uri,
                        mime: item.mime,
                        title,
                        fileName: shareFileName(title, item, pages.length),
                      });
                    }}
                  />
                )}
              />
            )}
          </View>
        )}
        {pages.length > 1 && (
          <View pointerEvents="none" style={styles.indicatorWrap}>
            <View style={[styles.indicator, { backgroundColor: theme.backgroundElement }]}>
              <Text variant="callout" accessibilityLiveRegion="polite">
                {pageLabel(Math.min(current, pages.length - 1))}
              </Text>
            </View>
          </View>
        )}
        {showPager && (
          <View style={[styles.pager, { borderTopColor: theme.separator }]}>
            <Button
              title="Previous"
              variant="secondary"
              onPress={() => goTo(current - 1)}
              disabled={current <= 0}
              style={styles.pagerButton}
            />
            <Button
              title="Next"
              variant="secondary"
              onPress={() => goTo(current + 1)}
              disabled={current >= pages.length - 1}
              style={styles.pagerButton}
            />
          </View>
        )}
      </View>

      {canEdit && (
        <EditSheet
          visible={editing}
          doc={doc}
          onClose={() => setEditing(false)}
          onSaved={(patch) => {
            setData((d) => (d ? { ...d, doc: { ...d.doc, ...patch } } : d));
            setEditing(false);
          }}
          onDeleted={() => {
            setEditing(false);
            router.back();
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ edit sheet

function isValidISODate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d && y >= 1900;
}

function addDays(iso: string, n: number) {
  const base = isValidISODate(iso) ? iso : todayISO();
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

const TYPES: { value: DocType; label: string }[] = [
  { value: 'prescription', label: 'Prescription' },
  { value: 'report', label: 'Report' },
];

function EditSheet({
  visible,
  doc,
  onClose,
  onSaved,
  onDeleted,
}: {
  visible: boolean;
  doc: Document;
  onClose: () => void;
  onSaved: (patch: { type: DocType; doc_date: string; title: string | null }) => void;
  onDeleted: () => void;
}) {
  const theme = useTheme();
  const [type, setType] = useState<DocType>(doc.type);
  const [date, setDate] = useState(doc.doc_date);
  const [title, setTitle] = useState(doc.title ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setType(doc.type);
    setDate(doc.doc_date);
    setTitle(doc.title ?? '');
    setError(null);
  };

  const dateError = !isValidISODate(date)
    ? 'Enter the date as YYYY-MM-DD, for example ' + todayISO()
    : date > todayISO()
      ? "The date can't be in the future."
      : null;

  const save = async () => {
    if (dateError) {
      setError(dateError);
      return;
    }
    setSaving(true);
    setError(null);
    const patch = { type, doc_date: date, title: title.trim() || null };
    try {
      await updateDocument(doc.id, patch);
      onSaved(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const ok = await confirm({
      title: 'Delete this document?',
      message: 'All its pages will be permanently deleted for everyone who can see them. This cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteDocument(doc.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const busy = saving || deleting;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onShow={reset}
      onRequestClose={() => {
        if (!busy) onClose();
      }}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheetBar, { borderBottomColor: theme.separator }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={onClose}
            disabled={busy}
            hitSlop={8}
            style={styles.sheetBarButton}>
            <Text color="text">Cancel</Text>
          </Pressable>
          <Text variant="headline" accessibilityRole="header">
            Edit details
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save"
            onPress={save}
            disabled={busy}
            hitSlop={8}
            style={[styles.sheetBarButton, { alignItems: 'flex-end', opacity: busy ? 0.4 : 1 }]}>
            <Text variant="headline">{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
          <Section title="Type">
            <View style={{ padding: Spacing.two }}>
              <Segmented options={TYPES} value={type} onChange={setType} />
            </View>
          </Section>

          <Section title="Date" footer={formatDateSafe(date)}>
            <Field
              label="Date (YYYY-MM-DD)"
              value={date}
              onChangeText={(t) => setDate(t.trim())}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              autoCapitalize="none"
              maxLength={10}
              placeholder={todayISO()}
            />
            <View style={[styles.dateButtons, { borderTopColor: theme.separator }]}>
              <Button title="−1 day" variant="secondary" onPress={() => setDate(addDays(date, -1))} style={styles.dateButton} />
              <Button title="Today" variant="secondary" onPress={() => setDate(todayISO())} style={styles.dateButton} />
              <Button
                title="+1 day"
                variant="secondary"
                onPress={() => setDate(addDays(date, 1))}
                disabled={date >= todayISO()}
                style={styles.dateButton}
              />
            </View>
          </Section>

          <Section title="Title" footer="Optional, e.g. Blood test or Dr. Rao">
            <Field
              label="Title"
              value={title}
              onChangeText={setTitle}
              placeholder={docTypeLabel[type]}
              maxLength={120}
              returnKeyType="done"
              onSubmitEditing={save}
            />
          </Section>

          {(error || (dateError && date.length >= 10)) && (
            <Text color="danger" accessibilityRole="alert" style={{ paddingHorizontal: Spacing.three }}>
              {error ?? dateError}
            </Text>
          )}

          <Button title="Delete document" variant="destructive" icon="trash" onPress={confirmDelete} loading={deleting} disabled={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function formatDateSafe(iso: string) {
  return isValidISODate(iso) ? formatDate(iso) : undefined;
}

function HeaderButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [styles.headerButton, (pressed || disabled) && { opacity: 0.5 }]}>
      <Icon name={icon} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerTitle: { alignItems: 'center', maxWidth: 220 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  indicatorWrap: { position: 'absolute', top: Spacing.three, left: 0, right: 0, alignItems: 'center' },
  indicator: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Radius.full },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetBarButton: { minWidth: 72, minHeight: 48, justifyContent: 'center' },
  sheetContent: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  dateButtons: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dateButton: { flex: 1, paddingHorizontal: Spacing.two },
  pager: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pagerButton: { flex: 1 },
});
