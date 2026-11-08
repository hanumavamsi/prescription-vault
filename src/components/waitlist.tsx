import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, EmptyState, Screen, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { deleteAccount } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirm, showMessage } from '@/lib/confirm';

/** Shown instead of the app while the account is waitlisted. Invite links still work on top of it. */
export function Waitlist({ onCheckAgain }: { onCheckAgain: () => void }) {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  async function remove() {
    const ok = await confirm({
      title: 'Delete your account?',
      message: 'This removes your account and your place on the waitlist.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteAccount();
    } catch (e) {
      showMessage('Could not delete your account', e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      <EmptyState
        icon="envelope"
        title="You're on the waitlist"
        message="Rx Vault is in a small beta for now. We'll email you as soon as there's a spot for you."
      />
      <Text variant="body" color="textSecondary" style={styles.center}>
        If someone in your family already uses Rx Vault, ask them to send you an invite link. Opening it lets you in
        right away.
      </Text>
      <View style={styles.actions}>
        <Button title="Check again" onPress={onCheckAgain} disabled={busy} />
        <Button title="Sign out" variant="secondary" onPress={signOut} disabled={busy} />
        <Button title="Delete my account" variant="destructive" onPress={remove} loading={busy} disabled={busy} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four, paddingTop: Spacing.five },
  center: { textAlign: 'center' },
  actions: { gap: Spacing.three },
});
