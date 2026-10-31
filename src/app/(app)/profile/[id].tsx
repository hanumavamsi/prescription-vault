import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, RefreshControl, Share, StyleSheet, View } from 'react-native';

import { Avatar, Button, ErrorState, Field, Loading, Row, Screen, Section, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { createClaimInvite, deleteManagedProfile, getProfile, leaveSharedProfile, updateProfile } from '@/lib/api';
import type { ProfileWithRole } from '@/lib/types';

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export default function ManageProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { data: profile, error, loading, refreshing, refresh, setData } = useQuery(() => getProfile(id), [id]);

  if (loading && !profile) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <Loading />
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <Stack.Screen options={{ title: 'Profile' }} />
        <Screen>
          <ErrorState message={error ?? 'Could not load this profile.'} onRetry={refresh} />
        </Screen>
      </>
    );
  }

  const title = profile.role === 'self' ? 'My profile' : profile.display_name;

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.text} />}>
        <View style={styles.hero}>
          <Avatar name={profile.display_name} size={88} />
          <Text variant="title2" style={{ textAlign: 'center' }}>
            {profile.display_name}
          </Text>
          <Text color="textSecondary" style={{ textAlign: 'center' }}>
            {profile.role === 'self'
              ? 'Your own records'
              : profile.role === 'managed'
                ? `Managed by you${profile.relation ? ` · ${profile.relation}` : ''}`
                : 'Shared with you · view only'}
          </Text>
        </View>

        {profile.role === 'viewer' ? (
          <ViewerSection profile={profile} />
        ) : (
          <>
            <DetailsSection profile={profile} onSaved={(p) => setData({ ...profile, ...p })} />
            {profile.role === 'self' ? (
              <Section>
                <Row icon="gearshape" title="Settings" subtitle="Account, app lock, privacy" onPress={() => router.push('/settings' as Href)} last />
              </Section>
            ) : (
              <ManagedSections profile={profile} />
            )}
          </>
        )}
      </Screen>
    </>
  );
}

function DetailsSection({
  profile,
  onSaved,
}: {
  profile: ProfileWithRole;
  onSaved: (patch: { display_name: string; relation: string | null }) => void;
}) {
  const [name, setName] = useState(profile.display_name);
  const [relation, setRelation] = useState(profile.relation ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isManaged = profile.role === 'managed';
  const trimmed = name.trim();
  const dirty = trimmed !== profile.display_name || (isManaged && relation.trim() !== (profile.relation ?? ''));

  const save = async () => {
    if (!trimmed) {
      setError('Please enter a name.');
      return;
    }
    setSaving(true);
    setError(null);
    const patch = isManaged
      ? { display_name: trimmed, relation: relation.trim() || null }
      : { display_name: trimmed };
    try {
      await updateProfile(profile.id, patch);
      onSaved({ display_name: trimmed, relation: isManaged ? relation.trim() || null : profile.relation });
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: Spacing.three }}>
      <Section title="Details">
        <Field
          label="Name"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setSaved(false);
          }}
          autoCapitalize="words"
          maxLength={80}
          returnKeyType="done"
        />
        {isManaged && (
          <Field
            label="Relation (optional)"
            value={relation}
            onChangeText={(t) => {
              setRelation(t);
              setSaved(false);
            }}
            placeholder="e.g. Mother, Son"
            autoCapitalize="words"
            maxLength={40}
            returnKeyType="done"
          />
        )}
      </Section>
      {error && (
        <Text color="danger" accessibilityRole="alert" style={{ paddingHorizontal: Spacing.three }}>
          {error}
        </Text>
      )}
      {(dirty || saving) && <Button title="Save changes" onPress={save} loading={saving} />}
      {saved && !dirty && (
        <Text color="textSecondary" accessibilityLiveRegion="polite" style={{ paddingHorizontal: Spacing.three }}>
          Saved.
        </Text>
      )}
    </View>
  );
}

function ManagedSections({ profile }: { profile: ProfileWithRole }) {
  const [inviting, setInviting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const name = profile.display_name;

  const invite = async () => {
    setInviting(true);
    try {
      const url = await createClaimInvite(profile.id);
      await Share.share({
        message: `Hi ${name}, I've been keeping your prescriptions and medical reports in Rx Vault. Open this link to take over your records in your own account (link valid for 7 days): ${url}`,
      });
    } catch (e) {
      Alert.alert('Could not create invite', message(e));
    } finally {
      setInviting(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      `Delete ${name}?`,
      `This permanently deletes ${name}'s profile and all of their documents. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteManagedProfile(profile.id);
              router.dismissTo('/' as Href);
            } catch (e) {
              setDeleting(false);
              Alert.alert('Could not delete', message(e));
            }
          },
        },
      ],
    );
  };

  return (
    <>
      <Section
        title="Hand over"
        footer={`Sends a link ${name} can open on their own phone. Once they accept, the records move to their account and you keep view access.`}>
        <Row
          icon="person.crop.circle.badge.checkmark"
          title={inviting ? 'Creating link…' : `Invite ${name} to take over this profile`}
          onPress={inviting ? undefined : invite}
          chevron={false}
          last
        />
      </Section>
      <Button title={`Delete ${name}`} icon="trash" variant="destructive" onPress={confirmDelete} loading={deleting} />
    </>
  );
}

function ViewerSection({ profile }: { profile: ProfileWithRole }) {
  const [leaving, setLeaving] = useState(false);
  const name = profile.display_name;

  const confirmLeave = () => {
    Alert.alert(
      `Stop viewing ${name}'s records?`,
      `You will no longer see ${name}'s documents. They can invite you again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop viewing',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            try {
              await leaveSharedProfile(profile.id);
              router.dismissTo('/' as Href);
            } catch (e) {
              setLeaving(false);
              Alert.alert('Something went wrong', message(e));
            }
          },
        },
      ],
    );
  };

  return (
    <>
      <Section footer={`${name} chose to share their records with you. You can view them but not add, change, or delete anything.`}>
        <Row icon="person.crop.circle" title="Shared by" value={name} last />
      </Section>
      <Button title="Stop viewing" icon="eye.slash" variant="destructive" onPress={confirmLeave} loading={leaving} />
    </>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
});
