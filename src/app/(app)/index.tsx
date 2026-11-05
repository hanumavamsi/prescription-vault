import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { applyDocFilter, DocFilters, isFiltered, NO_FILTER, type DocFilterValue } from '@/components/doc-filters';
import { DocRow } from '@/components/doc-row';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Loading,
  roleColorKey,
  roleLabel,
  Screen,
  SearchField,
  Section,
  Text,
} from '@/components/ui';
import { HitSize, Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { listDocuments, listProfiles } from '@/lib/api';
import { searchDocs } from '@/lib/search';
import type { Document, ProfileRole, ProfileWithRole } from '@/lib/types';

const AVATAR = 64;

function monthTitle(iso: string) {
  const [y, m] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Documents arrive newest first (by doc_date), so consecutive runs share a month. */
function groupByMonth(docs: Document[]) {
  const groups: { key: string; title: string; data: Document[] }[] = [];
  for (const d of docs) {
    const key = d.doc_date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.data.push(d);
    else groups.push({ key, title: monthTitle(d.doc_date), data: [d] });
  }
  return groups;
}

/**
 * The one records screen. The people row picks whose records are shown below (me by default), so
 * my records and a family member's look exactly the same. `?person=<id>` keeps the choice across
 * refreshes and links.
 */
export default function Home() {
  const theme = useTheme();
  const { person } = useLocalSearchParams<{ person?: string }>();
  const [filter, setFilter] = useState<DocFilterValue>(NO_FILTER);
  const [query, setQuery] = useState('');

  const people = useQuery(listProfiles);
  const profiles = people.data;
  const selected = profiles?.find((p) => p.id === person) ?? profiles?.find((p) => p.role === 'self');
  const docsQuery = useQuery(async () => (selected ? listDocuments(selected.id) : []), [selected?.id]);
  const docs = docsQuery.data;
  const groups = useMemo(
    () => (docs ? groupByMonth(applyDocFilter(searchDocs(docs, query), filter)) : []),
    [docs, filter, query],
  );
  const searching = query.trim().length > 0;

  const header = (
    <Stack.Screen
      options={{
        title: 'Rx Vault',
        headerRight: () => (
          <View style={styles.headerButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Family"
              accessibilityHint="Request to see a family member's records, and see who can see yours"
              onPress={() => router.push('/family' as Href)}
              hitSlop={6}
              style={({ pressed }) => [
                styles.sharePill,
                { backgroundColor: theme.backgroundSelected },
                pressed && { opacity: 0.6 },
              ]}>
              <Icon name="person.2" size={18} />
              <Text variant="callout" style={{ fontWeight: '600' }}>
                Family
              </Text>
            </Pressable>
            <IconButton icon="gearshape" label="Settings" onPress={() => router.push('/settings' as Href)} />
          </View>
        ),
      }}
    />
  );

  if (people.loading && !profiles) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }

  if (!profiles || !selected) {
    return (
      <>
        {header}
        <Screen>
          <ErrorState message={people.error ?? 'Could not load your records.'} onRetry={people.refresh} />
        </Screen>
      </>
    );
  }

  const roles = (['self', 'viewer', 'managed'] as const).filter((r) => profiles.some((p) => p.role === r));
  const canEdit = selected.role !== 'viewer';
  const isMe = selected.role === 'self';
  const error = people.error ?? docsQuery.error;

  const select = (p: ProfileWithRole) => {
    setFilter(NO_FILTER);
    setQuery('');
    router.setParams({ person: p.role === 'self' ? undefined : p.id });
  };
  const addDocument = () => router.push({ pathname: '/add', params: { profileId: selected.id } } as Href);
  const refresh = () => {
    people.refresh();
    docsQuery.refresh();
  };

  return (
    <>
      {header}
      <Screen
        refreshControl={
          <RefreshControl
            refreshing={people.refreshing || docsQuery.refreshing}
            onRefresh={refresh}
            tintColor={theme.text}
          />
        }>
        {error && (
          <Text variant="footnote" color="danger" accessibilityRole="alert">
            Couldn&apos;t refresh: {error}
          </Text>
        )}

        <PeopleRow profiles={profiles} selectedId={selected.id} onSelect={select} roles={roles} />

        <RecordsHeader profile={selected} onDetails={() => router.push(('/profile/' + selected.id) as Href)} />

        {canEdit && (
          <Button
            title={isMe ? 'Add my document' : `Add document for ${selected.display_name}`}
            icon="plus"
            onPress={addDocument}
            accessibilityHint="Scan or import a prescription or report"
          />
        )}

        {!docs ? (
          <ActivityIndicator style={styles.listLoading} color={theme.textSecondary} />
        ) : docs.length === 0 ? (
          <EmptyState
            icon="tray"
            title="No documents yet"
            message={
              isMe
                ? 'Scan a prescription, take a photo of a report, or import a PDF.'
                : canEdit
                  ? `Prescriptions and reports you add for ${selected.display_name} will show up here.`
                  : `${selected.display_name} hasn't added any documents yet.`
            }
          />
        ) : (
          <>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search doctor, specialty, hospital…"
              accessibilityLabel="Search documents"
            />
            <DocFilters value={filter} onChange={setFilter} />
            {groups.length === 0 ? (
              searching ? (
                <EmptyState
                  icon="magnifyingglass"
                  title="No matches"
                  message={`Nothing matches “${query.trim()}”${isFiltered(filter) ? ` in ${filter === 'prescription' ? 'prescriptions' : 'reports'}` : ''}. Try a doctor's name, a specialty like skin or heart, or a hospital.`}
                  action={
                    <Button
                      title="Clear search"
                      variant="secondary"
                      onPress={() => {
                        setQuery('');
                        setFilter(NO_FILTER);
                      }}
                    />
                  }
                />
              ) : (
                <EmptyState
                  icon="doc.text"
                  title={filter === 'prescription' ? 'No prescriptions' : 'No reports'}
                  message={`There are no ${filter === 'prescription' ? 'prescriptions' : 'reports'} here yet.`}
                  action={<Button title="Show all" variant="secondary" onPress={() => setFilter(NO_FILTER)} />}
                />
              )
            ) : (
              <>
                {(isFiltered(filter) || searching) && (
                  <Text variant="footnote" color="textSecondary" accessibilityLiveRegion="polite">
                    {groups.reduce((n, g) => n + g.data.length, 0)} found
                  </Text>
                )}
                {groups.map((g) => (
                  <Section key={g.key} title={g.title}>
                    {g.data.map((d, i) => (
                      <DocRow
                        key={d.id}
                        doc={d}
                        onPress={() => router.push(('/document/' + d.id) as Href)}
                        last={i === g.data.length - 1}
                      />
                    ))}
                  </Section>
                ))}
              </>
            )}
          </>
        )}
      </Screen>
    </>
  );
}

/** Horizontally scrolling picker; scrolls the selected person into view when it changes. */
function PeopleRow({
  profiles,
  selectedId,
  onSelect,
  roles,
}: {
  profiles: ProfileWithRole[];
  selectedId: string;
  onSelect: (p: ProfileWithRole) => void;
  roles: readonly ProfileRole[];
}) {
  const scroller = useRef<ScrollViewInstance>(null);
  const offsets = useRef(new Map<string, number>());
  useEffect(() => {
    const x = offsets.current.get(selectedId);
    if (x != null) scroller.current?.scrollTo({ x: Math.max(0, x - Spacing.four), animated: true });
  }, [selectedId]);

  return (
    <View style={styles.peopleBlock}>
      <ScrollView
        ref={scroller}
        horizontal
        // A mouse can't swipe: on web keep the scrollbar so overflowing family members stay reachable.
        showsHorizontalScrollIndicator={Platform.OS === 'web'}
        contentContainerStyle={styles.people}
        accessibilityLabel="Whose records to show">
        {profiles.map((p) => (
          <View key={p.id} onLayout={(e) => offsets.current.set(p.id, e.nativeEvent.layout.x)}>
            <PersonBubble profile={p} selected={p.id === selectedId} onPress={() => onSelect(p)} />
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a person"
          accessibilityHint="Request to see a family member's records, or add someone you manage"
          onPress={() => router.push('/add-person' as Href)}
          style={({ pressed }) => [styles.person, pressed && { opacity: 0.6 }]}>
          <Avatar name="+" size={AVATAR} dashed />
          <Text variant="footnote" color="textSecondary" numberOfLines={1} style={styles.personName}>
            Add
          </Text>
        </Pressable>
      </ScrollView>
      {roles.length > 1 && <RoleLegend roles={roles} />}
    </View>
  );
}

function PersonBubble({
  profile,
  selected,
  onPress,
}: {
  profile: ProfileWithRole;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const label = profile.role === 'self' ? 'Me' : profile.display_name;
  const who =
    profile.role === 'self'
      ? 'My records'
      : profile.role === 'viewer'
        ? `${profile.display_name}, shared with you`
        : `${profile.display_name}${profile.relation ? `, ${profile.relation}` : ''}, managed by you`;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={who}
      accessibilityState={{ selected }}
      onPress={selected ? undefined : onPress}
      style={({ pressed }) => [
        styles.person,
        selected && { backgroundColor: theme.backgroundSelected },
        pressed && !selected && { opacity: 0.6 },
      ]}>
      <Avatar name={profile.display_name || label} size={AVATAR} role={profile.role} />
      <Text variant="footnote" numberOfLines={1} style={[styles.personName, selected && { fontWeight: '700' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Same heading for everyone: whose records these are, how they relate to me, and their details. */
function RecordsHeader({ profile, onDetails }: { profile: ProfileWithRole; onDetails: () => void }) {
  const theme = useTheme();
  const isMe = profile.role === 'self';
  const title = isMe ? 'My records' : `${profile.display_name}'s records`;
  const subtitle = isMe
    ? profile.display_name || roleLabel.self
    : profile.role === 'viewer'
      ? 'Shared with me · view only'
      : [profile.relation, roleLabel.managed].filter(Boolean).join(' · ');
  return (
    <View style={[styles.whose, { borderTopColor: theme.separator }]}>
      <View style={[styles.whoseBar, { backgroundColor: theme[roleColorKey[profile.role]] }]} />
      <View style={styles.whoseText} accessible accessibilityRole="header" accessibilityLabel={`${title}. ${subtitle}`}>
        <Text variant="title2" numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.whoseSub}>
          {profile.role === 'viewer' && <Icon name="eye" size={14} color={theme.textSecondary} />}
          <Text variant="footnote" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>
      <IconButton icon="info.circle" label={isMe ? 'My profile details' : `About ${profile.display_name}`} onPress={onDetails} />
    </View>
  );
}

/** Explains the avatar ring colours; hidden from screen readers, which hear the role in each label. */
function RoleLegend({ roles }: { roles: readonly ProfileRole[] }) {
  const theme = useTheme();
  return (
    <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {roles.map((r) => (
        <View key={r} style={styles.legendItem}>
          <View style={[styles.legendDot, { borderColor: theme[roleColorKey[r]] }]} />
          <Text variant="footnote" color="textSecondary">
            {roleLabel[r]}
          </Text>
        </View>
      ))}
    </View>
  );
}

function IconButton({ icon, label, onPress }: { icon: 'gearshape' | 'info.circle'; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.5 }]}>
      <Icon name={icon} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  sharePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    minHeight: 36,
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.full,
  },
  peopleBlock: { gap: Spacing.two },
  people: { gap: Spacing.two, paddingVertical: Spacing.one },
  person: {
    width: AVATAR + 20,
    minHeight: HitSize,
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    borderRadius: Radius.medium,
  },
  personName: { textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 3 },
  whose: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  whoseBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  whoseText: { flex: 1, gap: 2 },
  whoseSub: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  listLoading: { paddingVertical: Spacing.five },
});
