import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Platform, RefreshControl, StyleSheet, View } from 'react-native';

import { Avatar, Button, ErrorState, Field, Loading, Row, Screen, Section, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { createClaimInvite, deleteManagedProfile, getProfile, leaveSharedProfile, updateProfile } from '@/lib/api';
import { confirm, showMessage } from '@/lib/confirm';
import { copyText, shareText } from '@/lib/share';
import type { ProfileWithRole } from '@/lib/types';

/** Web: whether the browser has a share sheet (iPhone Safari, Android Chrome). */
const canWebShare = Platform.OS === 'web' && typeof navigator !== 'undefined' && typeof navigator.share === 'function';

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
  const theme = useTheme();
  const [inviting, setInviting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** Web only: the last invite link, shown so it can be shared again or copied when the browser can't share. */
  const [inviteLink, setInviteLink] = useState<{ url: string; message: string; note?: string } | null>(null);
  const name = profile.display_name;

  const invite = async () => {
    setInviting(true);
    setInviteLink(null);
    try {
      const url = await createClaimInvite(profile.id);
      const text = `Hi ${name}, I've been keeping your prescriptions and medical reports in Rx Vault. Open this link to take over your records in your own account (link valid for 7 days): ${url}`;
      if (Platform.OS === 'web') {
        setInviteLink({ url, message: text });
        await shareInvite({ url, message: text });
        return;
      }
      await shareText(text, url);
    } catch (e) {
      showMessage('Could not create invite', message(e));
    } finally {
      setInviting(false);
    }
  };

  /** Web: see shareInvite in family.tsx — a refused share just asks for another tap. */
  const shareInvite = async (link: { url: string; message: string }) => {
    try {
      const result = await shareText(link.message, link.url);
      if (result === 'copied') setInviteLink({ ...link, note: 'Invite message copied. Paste it into WhatsApp, SMS or email.' });
    } catch {
      setInviteLink({ ...link, note: 'Tap Share or Copy link to send it.' });
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    const copied = await copyText(inviteLink.url);
    setInviteLink({
      ...inviteLink,
      note: copied ? 'Link copied.' : 'Your browser blocked copying. Select the link above and copy it.',
    });
  };

  const confirmDelete = async () => {
    const ok = await confirm({
      title: `Delete ${name}?`,
      message: `This permanently deletes ${name}'s profile and all of their documents. This cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteManagedProfile(profile.id);
      router.dismissTo('/' as Href);
    } catch (e) {
      setDeleting(false);
      showMessage('Could not delete', message(e));
    }
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
      {inviteLink && (
        <View style={[styles.link, { backgroundColor: theme.backgroundElement }]}>
          <Text variant="footnote" color="textSecondary">
            Invite link (valid for 7 days)
          </Text>
          <Text selectable accessibilityLabel={`Invite link ${inviteLink.url}`}>
            {inviteLink.url}
          </Text>
          {canWebShare && (
            <Button title="Share" icon="square.and.arrow.up" variant="secondary" onPress={() => shareInvite(inviteLink)} />
          )}
          <Button title="Copy link" icon="link" variant="secondary" onPress={copyInviteLink} />
          {inviteLink.note && (
            <Text color="textSecondary" accessibilityLiveRegion="polite">
              {inviteLink.note}
            </Text>
          )}
        </View>
      )}
      <Button title={`Delete ${name}`} icon="trash" variant="destructive" onPress={confirmDelete} loading={deleting} />
    </>
  );
}

function ViewerSection({ profile }: { profile: ProfileWithRole }) {
  const [leaving, setLeaving] = useState(false);
  const name = profile.display_name;

  const confirmLeave = async () => {
    const ok = await confirm({
      title: `Stop viewing ${name}'s records?`,
      message: `You will no longer see ${name}'s documents. They can invite you again later.`,
      confirmText: 'Stop viewing',
      destructive: true,
    });
    if (!ok) return;
    setLeaving(true);
    try {
      await leaveSharedProfile(profile.id);
      router.dismissTo('/' as Href);
    } catch (e) {
      setLeaving(false);
      showMessage('Something went wrong', message(e));
    }
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
  link: { padding: Spacing.three, gap: Spacing.two, borderRadius: Radius.large },
});
