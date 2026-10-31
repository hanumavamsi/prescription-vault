import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar, Button, EmptyState, ErrorState, Loading, Screen, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { acceptInvite, declineInvite, getInvite } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setPendingInvite } from '@/lib/pending-invite';
import type { InvitePreview } from '@/lib/types';

export default function InviteScreen() {
  const { token: raw } = useLocalSearchParams<{ token: string }>();
  const token = Array.isArray(raw) ? raw[0] : raw;
  const { session } = useAuth();
  const [stored, setStored] = useState(false);

  // Signed out: remember the invite, sign in, and the root layout brings us back here.
  useEffect(() => {
    if (session || !token) return;
    setPendingInvite(token).finally(() => setStored(true));
  }, [session, token]);

  if (!session) return stored || !token ? <Redirect href={'/sign-in' as never} /> : <Loading />;
  if (!token) return <Invalid title="Invite link is incomplete" />;
  return <InviteBody token={token} />;
}

function goHome() {
  // Opened on top of the app (normal case): just close. Cold-started from a link: go to Home.
  if (router.canGoBack()) router.back();
  else router.replace('/' as never);
}

function InviteBody({ token }: { token: string }) {
  const { data: invite, error, loading, refresh } = useQuery<InvitePreview | null>(() => getInvite(token), [token]);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(kind: 'accept' | 'decline') {
    setBusy(kind);
    setActionError(null);
    try {
      if (kind === 'accept') await acceptInvite(token);
      else await declineInvite(token);
      goHome();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(
        /expired/i.test(msg)
          ? 'This invite has expired or was already used. Ask for a new link.'
          : /own invite/i.test(msg)
            ? 'You cannot accept your own invite.'
            : `Could not ${kind} the invite. ${msg}`,
      );
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Loading />;
  if (error || invite === undefined) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load this invite.'} onRetry={refresh} />
      </Screen>
    );
  }
  if (invite === null) return <Invalid title="Invite not found" message="This link is not valid. Ask for a new one." />;
  if (invite.is_own) {
    return (
      <Invalid
        title="This is your own invite"
        message="Share this link with a family member. They open it on their phone to respond."
      />
    );
  }
  if (!invite.valid) {
    return <Invalid title="Invite expired" message="This invite has expired or was already used. Ask for a new link." />;
  }

  const from = invite.from_name?.trim() || 'Someone';
  const profile = invite.profile_name?.trim() || 'someone';
  const isView = invite.purpose === 'view';

  return (
    <Screen contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: isView ? 'Access request' : 'Profile handover' }} />
      <View style={styles.head}>
        <Avatar name={from} size={80} />
        <Text variant="title" accessibilityRole="header" style={styles.center}>
          {isView ? `${from} wants to view your health records` : `${from} is handing over ${profile}'s profile`}
        </Text>
      </View>

      <Text variant="body" style={styles.center}>
        {isView
          ? `${from} wants to view your health records. They will be able to see, but not change, your prescriptions and reports. You can remove access anytime in Family.`
          : `${from} created a profile for ${profile} and wants to hand it to you. Its records will move to your account and ${from} will keep view access.`}
      </Text>

      {actionError && (
        <Text color="danger" accessibilityRole="alert" style={styles.center}>
          {actionError}
        </Text>
      )}

      <View style={styles.actions}>
        <Button
          title={isView ? 'Approve' : 'Accept'}
          loading={busy === 'accept'}
          disabled={!!busy}
          onPress={() => act('accept')}
          accessibilityHint={
            isView ? `Gives ${from} view-only access to your records` : `Moves ${profile}'s records into your account`
          }
        />
        <Button
          title="Decline"
          variant="secondary"
          loading={busy === 'decline'}
          disabled={!!busy}
          onPress={() => act('decline')}
        />
      </View>
    </Screen>
  );
}

function Invalid({ title, message }: { title: string; message?: string }) {
  return (
    <Screen>
      <EmptyState
        icon="link"
        title={title}
        message={message}
        action={<Button title="Go to my records" variant="secondary" onPress={goHome} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four, paddingTop: Spacing.five },
  head: { alignItems: 'center', gap: Spacing.three },
  center: { textAlign: 'center' },
  actions: { gap: Spacing.three },
});
