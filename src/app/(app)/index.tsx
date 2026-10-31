import { router, Stack, type Href } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { DocRow } from '@/components/doc-row';
import { Avatar, Button, EmptyState, ErrorState, Icon, Loading, Screen, Section, Text, type IconName } from '@/components/ui';
import { HitSize, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { listProfiles, listRecentDocuments } from '@/lib/api';
import type { ProfileWithRole } from '@/lib/types';

const AVATAR = 64;

export default function Home() {
  const theme = useTheme();
  const { data, error, loading, refreshing, refresh } = useQuery(async () => {
    const [profiles, recent] = await Promise.all([listProfiles(), listRecentDocuments(10)]);
    return { profiles, recent };
  });

  const header = (
    <Stack.Screen
      options={{
        title: 'Rx Vault',
        headerRight: () => (
          <View style={styles.headerButtons}>
            <HeaderButton icon="person.2" label="Family" onPress={() => router.push('/family' as Href)} />
            <HeaderButton icon="gearshape" label="Settings" onPress={() => router.push('/settings' as Href)} />
          </View>
        ),
      }}
    />
  );

  if (loading && !data) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }

  if (!data) {
    return (
      <>
        {header}
        <Screen>
          <ErrorState message={error ?? 'Could not load your records.'} onRetry={refresh} />
        </Screen>
      </>
    );
  }

  const { profiles, recent } = data;
  const self = profiles.find((p) => p.role === 'self');
  const names = new Map(profiles.map((p) => [p.id, p.role === 'self' ? 'Me' : p.display_name]));
  const firstRun = recent.length === 0 && profiles.length <= 1;

  const addDocument = () =>
    router.push({ pathname: '/add', params: self ? { profileId: self.id } : {} } as Href);

  return (
    <>
      {header}
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.text} />}>
        {error && (
          <Text variant="footnote" color="danger" accessibilityRole="alert">
            Couldn&apos;t refresh: {error}
          </Text>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.people}
          accessibilityLabel="Family members">
          {profiles.map((p) => (
            <PersonBubble key={p.id} profile={p} />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a family member"
            onPress={() => router.push('/profile/new' as Href)}
            style={({ pressed }) => [styles.person, pressed && { opacity: 0.6 }]}>
            <Avatar name="+" size={AVATAR} dashed />
            <Text variant="footnote" color="textSecondary" numberOfLines={1} style={styles.personName}>
              Add
            </Text>
          </Pressable>
        </ScrollView>

        <Button title="Add document" icon="plus" onPress={addDocument} accessibilityHint="Scan or import a prescription or report" />

        {firstRun ? (
          <EmptyState
            icon="lock.doc"
            title="Your health records, in one safe place"
            message="Scan a prescription, take a photo of a report, or import a PDF. Add family members to keep their records here too."
          />
        ) : recent.length === 0 ? (
          <EmptyState icon="doc.text" title="No documents yet" message="Documents you add will show up here." />
        ) : (
          <Section title="Recent">
            {recent.map((d, i) => (
              <DocRow
                key={d.id}
                doc={d}
                personName={names.get(d.profile_id)}
                onPress={() => router.push(('/document/' + d.id) as Href)}
                last={i === recent.length - 1}
              />
            ))}
          </Section>
        )}
      </Screen>
    </>
  );
}

function PersonBubble({ profile }: { profile: ProfileWithRole }) {
  const label = profile.role === 'self' ? 'Me' : profile.display_name;
  const a11y =
    profile.role === 'self'
      ? 'My records'
      : profile.role === 'viewer'
        ? `${profile.display_name}, shared with you`
        : `${profile.display_name}${profile.relation ? `, ${profile.relation}` : ''}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => router.push(('/person/' + profile.id) as Href)}
      style={({ pressed }) => [styles.person, pressed && { opacity: 0.6 }]}>
      <Avatar name={profile.display_name || label} size={AVATAR} />
      <Text variant="footnote" numberOfLines={1} style={styles.personName}>
        {label}
      </Text>
    </Pressable>
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
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  people: { gap: Spacing.three, paddingVertical: Spacing.one },
  person: { width: AVATAR + 12, minHeight: HitSize, alignItems: 'center', gap: Spacing.one },
  personName: { textAlign: 'center' },
});
