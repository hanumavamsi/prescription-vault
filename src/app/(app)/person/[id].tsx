import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { DocRow } from '@/components/doc-row';
import { Button, EmptyState, ErrorState, Icon, Loading, Screen, Segmented, Text, useWebBottomInset, type IconName } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { getProfile, listDocuments } from '@/lib/api';
import type { DocType, Document } from '@/lib/types';

type Filter = 'all' | DocType;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'prescription', label: 'Prescriptions' },
  { value: 'report', label: 'Reports' },
];

function monthTitle(iso: string) {
  const [y, m] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function groupByMonth(docs: Document[]) {
  const sections: { title: string; key: string; data: Document[] }[] = [];
  for (const d of docs) {
    const key = d.doc_date.slice(0, 7);
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.data.push(d);
    else sections.push({ key, title: monthTitle(d.doc_date), data: [d] });
  }
  return sections;
}

export default function PersonTimeline() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const webBottom = useWebBottomInset();

  const { data, error, loading, refreshing, refresh } = useQuery(async () => {
    const [profile, docs] = await Promise.all([getProfile(id), listDocuments(id)]);
    return { profile, docs };
  }, [id]);

  const sections = useMemo(() => {
    if (!data) return [];
    const docs = filter === 'all' ? data.docs : data.docs.filter((d) => d.type === filter);
    return groupByMonth(docs);
  }, [data, filter]);

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
          <ErrorState message={error ?? 'Could not load records.'} onRetry={refresh} />
        </Screen>
      </>
    );
  }

  const { profile, docs } = data;
  const canEdit = profile.role !== 'viewer';
  const name = profile.role === 'self' ? 'My records' : profile.display_name;
  const addDocument = () => router.push({ pathname: '/add', params: { profileId: profile.id } } as Href);

  const empty = (() => {
    if (docs.length === 0) {
      return (
        <EmptyState
          icon="tray"
          title="No documents yet"
          message={
            canEdit
              ? 'Scan or import prescriptions and reports to keep them here.'
              : `${profile.display_name} hasn't added any documents yet.`
          }
          action={canEdit ? <Button title="Add document" icon="plus" onPress={addDocument} /> : undefined}
        />
      );
    }
    return filter === 'prescription' ? (
      <EmptyState icon="pills" title="No prescriptions" message="Prescriptions you add will appear here." />
    ) : (
      <EmptyState icon="doc.text" title="No reports" message="Lab and medical reports you add will appear here." />
    );
  })();

  return (
    <>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () => (
            <View style={styles.headerButtons}>
              {canEdit && <HeaderButton icon="plus" label="Add document" onPress={addDocument} />}
              <HeaderButton
                icon="info.circle"
                label={profile.role === 'self' ? 'Profile details' : `About ${profile.display_name}`}
                onPress={() => router.push(('/profile/' + profile.id) as Href)}
              />
            </View>
          ),
        }}
      />
      <SectionList
        style={{ flex: 1, backgroundColor: theme.background }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, webBottom > 0 && { paddingBottom: Spacing.six + webBottom }]}
        sections={sections}
        keyExtractor={(d) => d.id}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.text} />}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {error && (
              <Text variant="footnote" color="danger" accessibilityRole="alert">
                Couldn&apos;t refresh: {error}
              </Text>
            )}
            {!canEdit && (
              <View
                style={[styles.banner, { backgroundColor: theme.backgroundSelected }]}
                accessible
                accessibilityLabel="Shared with you. View only.">
                <Icon name="eye" size={18} color={theme.textSecondary} />
                <Text variant="callout" color="textSecondary">
                  Shared with you · view only
                </Text>
              </View>
            )}
            <Segmented options={FILTERS} value={filter} onChange={setFilter} />
          </View>
        }
        ListEmptyComponent={empty}
        renderSectionHeader={({ section }) => (
          <Text variant="footnote" color="textSecondary" style={styles.sectionTitle} accessibilityRole="header">
            {section.title.toUpperCase()}
          </Text>
        )}
        renderItem={({ item, index, section }) => {
          const first = index === 0;
          const last = index === section.data.length - 1;
          return (
            <View
              style={[
                { backgroundColor: theme.backgroundElement, overflow: 'hidden' },
                first && styles.groupTop,
                last && styles.groupBottom,
              ]}>
              <DocRow doc={item} onPress={() => router.push(('/document/' + item.id) as Href)} last={last} />
            </View>
          );
        }}
      />
    </>
  );
}

function HeaderButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.5 }]}>
      <Icon name={icon} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  listHeader: { gap: Spacing.three, marginBottom: Spacing.two },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.medium,
  },
  sectionTitle: { paddingHorizontal: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.two },
  groupTop: { borderTopLeftRadius: Radius.medium, borderTopRightRadius: Radius.medium },
  groupBottom: { borderBottomLeftRadius: Radius.medium, borderBottomRightRadius: Radius.medium },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
