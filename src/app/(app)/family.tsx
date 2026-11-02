import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import {
  Avatar,
  Button,
  ErrorState,
  Loading,
  Row,
  Screen,
  Section,
  Text,
} from '@/components/ui';
import { HitSize, Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { createViewInvite, listMyViewers, listProfiles, revokeGrant } from '@/lib/api';
import { confirm, showMessage } from '@/lib/confirm';
import { copyText, shareText } from '@/lib/share';
import type { Viewer } from '@/lib/types';

/** `since` is a UTC timestamp; show the local calendar date (formatDate is for plain YYYY-MM-DD). */
function formatTimestamp(ts: string) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

async function loadFamily() {
  const [profiles, viewers] = await Promise.all([listProfiles(), listMyViewers()]);
  return {
    managed: profiles.filter((p) => p.role === 'managed'),
    shared: profiles.filter((p) => p.role === 'viewer'),
    viewers,
  };
}

export default function FamilyScreen() {
  const theme = useTheme();
  const { data, error, loading, refreshing, refresh, setData } = useQuery(loadFamily);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  /** Web only: the last invite link, shown so it can be copied when the browser can't share. */
  const [inviteLink, setInviteLink] = useState<{ url: string; note?: string } | null>(null);

  async function invite() {
    setInviting(true);
    setInviteError(null);
    setInviteLink(null);
    try {
      const url = await createViewInvite();
      const message = `I'd like to be able to see your prescriptions and reports in Rx Vault so I can help you. I can only view them, not change anything. Open this link to approve or decline (valid for 7 days): ${url}`;
      if (Platform.OS === 'web') setInviteLink({ url });
      const result = await shareText(message, url);
      if (result === 'copied') setInviteLink({ url, note: 'Invite message copied. Paste it into WhatsApp, SMS or email.' });
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Could not create the invite link. Please try again.');
    } finally {
      setInviting(false);
    }
  }

  async function confirmRemove(v: Viewer) {
    const name = v.display_name || 'This person';
    const ok = await confirm({
      title: `Remove ${v.display_name || 'this person'}?`,
      message: `${name} will no longer be able to see your prescriptions and reports. You can invite them again later.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (ok) void remove(v);
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    const copied = await copyText(inviteLink.url);
    setInviteLink({
      url: inviteLink.url,
      note: copied ? 'Link copied.' : 'Your browser blocked copying. Select the link above and copy it.',
    });
  }

  async function remove(v: Viewer) {
    setRemoving(v.grant_id);
    try {
      await revokeGrant(v.grant_id);
      setData((d) => (d ? { ...d, viewers: d.viewers.filter((x) => x.grant_id !== v.grant_id) } : d));
    } catch (e) {
      showMessage('Could not remove access', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setRemoving(null);
    }
  }

  const header = <Stack.Screen options={{ title: 'Family' }} />;

  if (loading && !data) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }
  if (error && !data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {header}
        <ErrorState message={error} onRetry={refresh} />
      </View>
    );
  }
  if (!data) return null;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.text} />}>
      {header}

      {error && (
        <Text color="danger" accessibilityRole="alert" style={styles.banner}>
          Could not refresh: {error}
        </Text>
      )}

      <Section
        title="Ask to see records"
        footer="They get a link. Once they approve, you can see their prescriptions and reports. You can only view — you cannot change or delete anything.">
        <View style={styles.card}>
          <Text color="textSecondary">
            Help a parent or relative who already uses the app. Send them a request, and when they approve you’ll see
            their records here.
          </Text>
          <Button title="Invite family member" icon="paperplane" onPress={invite} loading={inviting} />
          {inviteError && (
            <Text color="danger" accessibilityRole="alert">
              {inviteError}
            </Text>
          )}
          {inviteLink && (
            <View style={[styles.link, { backgroundColor: theme.backgroundSelected }]}>
              <Text variant="footnote" color="textSecondary">
                Invite link (valid for 7 days)
              </Text>
              <Text selectable accessibilityLabel={`Invite link ${inviteLink.url}`}>
                {inviteLink.url}
              </Text>
              <Button title="Copy link" icon="link" variant="secondary" onPress={copyInviteLink} />
              {inviteLink.note && (
                <Text color="textSecondary" accessibilityLiveRegion="polite">
                  {inviteLink.note}
                </Text>
              )}
            </View>
          )}
        </View>
      </Section>

      <Section
        title="People I manage"
        footer="For children or elders who don’t use the app. You add and manage their records.">
        {data.managed.map((p) => (
          <Row
            key={p.id}
            title={p.display_name}
            subtitle={p.relation ?? undefined}
            left={<Avatar name={p.display_name} size={40} />}
            onPress={() => router.push(('/profile/' + p.id) as never)}
          />
        ))}
        <Row
          title="Add someone without the app"
          icon="person.badge.plus"
          onPress={() => router.push('/profile/new' as never)}
          last
        />
      </Section>

      <Section
        title="Shared with me"
        footer={data.shared.length ? 'View only. Only they can add, change or delete their records.' : undefined}>
        {data.shared.length ? (
          data.shared.map((p, i) => (
            <Row
              key={p.id}
              title={p.display_name}
              subtitle="View only"
              left={<Avatar name={p.display_name} size={40} />}
              onPress={() => router.push(('/person/' + p.id) as never)}
              last={i === data.shared.length - 1}
            />
          ))
        ) : (
          <Row title="No one yet" subtitle="Use “Invite family member” above to ask." icon="person.2" last />
        )}
      </Section>

      <Section
        title="Who can see my records"
        footer="These people can view your prescriptions and reports but cannot change or delete them. Remove someone at any time.">
        {data.viewers.length ? (
          data.viewers.map((v, i) => (
            <Row
              key={v.grant_id}
              title={v.display_name || 'Family member'}
              subtitle={`Can view since ${formatTimestamp(v.since)}`}
              left={<Avatar name={v.display_name || '?'} size={40} />}
              last={i === data.viewers.length - 1}
              right={
                <RemoveButton
                  label={`Remove ${v.display_name || 'family member'}`}
                  busy={removing === v.grant_id}
                  onPress={() => confirmRemove(v)}
                />
              }
            />
          ))
        ) : (
          <Row title="Only you" subtitle="No one else can see your records." icon="lock" last />
        )}
      </Section>
    </Screen>
  );
}

function RemoveButton({ label, onPress, busy }: { label: string; onPress: () => void; busy: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.remove,
        { backgroundColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
      ]}>
      {busy ? (
        <ActivityIndicator color={theme.danger} />
      ) : (
        <Text variant="callout" color="danger" style={{ fontWeight: '600' }}>
          Remove
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, gap: Spacing.three },
  banner: { paddingHorizontal: Spacing.three },
  link: { padding: Spacing.three, gap: Spacing.two, borderRadius: Radius.medium },
  remove: {
    minHeight: HitSize - 8,
    minWidth: 88,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
