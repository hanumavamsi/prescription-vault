import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { Switch, StyleSheet, View } from 'react-native';

import { Button, ErrorState, Field, formatBytes, Icon, Loading, Row, Screen, Section, Text } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { deleteAccount, getStorageUsage, listProfiles, updateProfile } from '@/lib/api';
import { useAppLock } from '@/lib/app-lock';
import { useAuth } from '@/lib/auth';
import { cacheSizeBytes, clearCache } from '@/lib/cache';
import { confirm } from '@/lib/confirm';
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL, openLink } from '@/lib/links';
import { isWeb } from '@/lib/runtime';

/** Destructive confirmation (Alert on native, the browser dialog on web). */
function confirmDestructive(title: string, message: string, action: string, onConfirm: () => void) {
  confirm({ title, message, confirmText: action, destructive: true }).then((ok) => {
    if (ok) onConfirm();
  });
}

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const profiles = useQuery(listProfiles);
  const me = profiles.data?.find((p) => p.role === 'self');

  if (profiles.loading && !profiles.data) return <Loading />;
  if (profiles.error && !profiles.data) {
    return (
      <Screen>
        <ErrorState message={profiles.error} onRetry={profiles.refresh} />
      </Screen>
    );
  }

  return (
    <Screen>
      <AccountSection
        key={me?.display_name ?? ''}
        profileId={me?.id}
        name={me?.display_name ?? ''}
        email={user?.email}
        onSaved={profiles.refresh}
      />
      {!isWeb && <LockSection />}
      <CloudStorageSection />
      <StorageSection />
      <AboutSection />
      <Section>
        <Row
          title="Sign out"
          icon="rectangle.portrait.and.arrow.right"
          onPress={() =>
            confirmDestructive(
              'Sign out?',
              isWeb ? 'You will need to sign in again on this browser.' : 'Downloaded files will be removed from this phone.',
              'Sign out',
              () => signOut().catch(() => {}),
            )
          }
          chevron={false}
          last
        />
      </Section>
      <DeleteAccountSection />
    </Screen>
  );
}

// ------------------------------------------------------------------ account

function AccountSection({
  profileId,
  name,
  email,
  onSaved,
}: {
  profileId?: string;
  name: string;
  email?: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.trim();
  const dirty = trimmed !== name && trimmed.length > 0;

  async function save() {
    if (!profileId || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await updateProfile(profileId, { display_name: trimmed.slice(0, 80) });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.block}>
      <Section title="Account" footer={error ?? 'Your name is shown to family members you share with.'}>
        <Field
          label="Your name"
          value={draft}
          onChangeText={setDraft}
          maxLength={80}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={save}
          editable={!!profileId}
        />
        <SeparatorLine />
        <Row title="Email" value={email || 'Hidden'} last />
      </Section>
      {dirty && <Button title="Save name" loading={saving} onPress={save} />}
    </View>
  );
}

function SeparatorLine() {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.separator, marginLeft: Spacing.three }} />;
}

// ------------------------------------------------------------------ app lock

function LockSection() {
  const theme = useTheme();
  const { enabled, available, setEnabled } = useAppLock();
  const [error, setError] = useState<string | null>(null);

  async function toggle(v: boolean) {
    setError(null);
    try {
      await setEnabled(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const footer =
    error ??
    (available
      ? 'Ask for Face ID, fingerprint or your passcode when opening the app or after a minute away.'
      : 'Set up Face ID, fingerprint or a passcode in your phone settings to use App lock.');

  return (
    <Section title="Security" footer={footer}>
      <Row
        title="App lock"
        icon="lock"
        last
        right={
          <Switch
            value={enabled}
            onValueChange={toggle}
            disabled={!available && !enabled}
            trackColor={{ true: theme.tint, false: theme.backgroundSelected }}
            thumbColor={theme.backgroundElement}
            ios_backgroundColor={theme.backgroundSelected}
            accessibilityLabel="App lock"
          />
        }
      />
    </Section>
  );
}

// ------------------------------------------------------------------ cloud storage

function CloudStorageSection() {
  const theme = useTheme();
  const usage = useQuery(getStorageUsage);
  if (!usage.data) return null;
  const { used, quota } = usage.data;
  const label = `${formatBytes(used)} of ${formatBytes(quota)} used`;
  return (
    <Section title="Cloud storage" footer="Counts files in your records and the profiles you manage.">
      <View style={styles.usage} accessible accessibilityLabel={`Cloud storage: ${label}`}>
        <Text>{label}</Text>
        <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[
              styles.barFill,
              { width: `${Math.min(100, (used / quota) * 100)}%`, backgroundColor: used >= quota ? theme.danger : theme.tint },
            ]}
          />
        </View>
      </View>
    </Section>
  );
}

// ------------------------------------------------------------------ storage

function StorageSection() {
  const [size, setSize] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(() => {
    cacheSizeBytes()
      .then(setSize)
      .catch(() => setSize(0));
  }, []);

  useEffect(load, [load]);

  async function clear() {
    setClearing(true);
    try {
      await clearCache();
    } catch {
      // Best effort; size below reflects what is left.
    } finally {
      setClearing(false);
      load();
    }
  }

  // The web app reads files straight from the server, so there is usually nothing stored to show.
  if (isWeb && !size) return null;

  return (
    <Section
      title="Storage"
      footer="Recently opened records are kept on this phone so they open quickly and work offline.">
      <Row title="Downloaded files" icon="internaldrive" value={size == null ? '…' : formatBytes(size)} />
      <Row
        title={clearing ? 'Clearing…' : 'Clear downloaded files'}
        icon="trash"
        chevron={false}
        onPress={clearing || !size ? undefined : clear}
        last
      />
    </Section>
  );
}

// ------------------------------------------------------------------ about

function AboutSection() {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const build = Constants.nativeBuildVersion;
  return (
    <Section title="About">
      {PRIVACY_URL && <Row title="Privacy policy" icon="hand.raised" onPress={() => openLink(PRIVACY_URL)} />}
      {TERMS_URL && <Row title="Terms of use" icon="doc.plaintext" onPress={() => openLink(TERMS_URL)} />}
      {SUPPORT_EMAIL && <Row title="Support" icon="envelope" value={SUPPORT_EMAIL} />}
      <Row title="Version" icon="info.circle" value={build ? `${version} (${build})` : version} last />
    </Section>
  );
}

// ------------------------------------------------------------------ delete account

function DeleteAccountSection() {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typed.trim().toUpperCase() === 'DELETE';

  async function doDelete() {
    setDeleting(true);
    setError(null);
    try {
      await clearCache().catch(() => {});
      await deleteAccount();
      // Auth state change sends the user back to sign-in.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  function askFinal() {
    confirmDestructive(
      'Delete account permanently?',
      'All your records and the profiles you manage will be deleted. This cannot be undone.',
      'Delete',
      doDelete,
    );
  }

  if (!open) {
    return (
      <Section>
        <Row title="Delete account" icon="person.crop.circle.badge.xmark" destructive onPress={() => setOpen(true)} last />
      </Section>
    );
  }

  return (
    <View style={[styles.danger, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.dangerHead}>
        <Icon name="exclamationmark.triangle.fill" size={24} color={theme.danger} />
        <Text variant="headline" color="danger" accessibilityRole="header">
          Delete account
        </Text>
      </View>
      <Text>
        This permanently deletes your account, all your prescriptions and reports, and every profile you manage,
        including their records. Family members will lose access to them. This cannot be undone.
      </Text>
      <Field
        label="Type DELETE to confirm"
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="DELETE"
        editable={!deleting}
      />
      {error && (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Button
        title="Delete my account"
        variant="destructive"
        disabled={!confirmed}
        loading={deleting}
        onPress={askFinal}
        style={confirmed ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.danger } : undefined}
      />
      <Button
        title="Cancel"
        variant="plain"
        disabled={deleting}
        onPress={() => {
          setOpen(false);
          setTyped('');
          setError(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.three },
  usage: { padding: Spacing.three, gap: Spacing.two },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%' },
  danger: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.three },
  dangerHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
