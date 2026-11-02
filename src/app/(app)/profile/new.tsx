import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button, Field, Icon, Screen, Section, Text } from '@/components/ui';
import { HitSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createManagedProfile } from '@/lib/api';

const RELATIONS = ['Father', 'Mother', 'Son', 'Daughter', 'Spouse', 'Grandparent', 'Other'] as const;

export default function NewProfileScreen() {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const canCreate = trimmed.length > 0 && !saving;

  async function create() {
    if (!trimmed) {
      setError('Please enter a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createManagedProfile(trimmed, relation.trim() || undefined);
      // The presenting screen refetches on focus, so the new person appears there.
      router.back();
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : 'Could not create the profile. Please try again.');
    }
  }

  return (
    <Screen automaticallyAdjustKeyboardInsets>
      <Stack.Screen
        options={{
          title: 'Add person',
          headerLeft: () => (
            <HeaderButton label="Cancel" onPress={() => router.back()} disabled={saving} />
          ),
          headerRight: () => <HeaderButton label="Create" bold onPress={create} disabled={!canCreate} />,
        }}
      />

      <Section>
        <Field
          label="Name"
          value={name}
          onChangeText={(t) => {
            setName(t);
            if (error) setError(null);
          }}
          placeholder="e.g. Lakshmi Devi"
          autoFocus
          autoCapitalize="words"
          autoComplete="off"
          textContentType="name"
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={create}
          editable={!saving}
        />
      </Section>

      <Section title="Relation (optional)">
        <View style={styles.chips}>
          {RELATIONS.map((r) => {
            const selected = relation === r;
            return (
              <Pressable
                key={r}
                accessibilityRole="button"
                accessibilityLabel={r}
                accessibilityState={{ selected, disabled: saving }}
                disabled={saving}
                onPress={() => setRelation(selected ? '' : r)}
                style={({ pressed }) => [
                  styles.chip,
                  { backgroundColor: selected ? theme.tint : theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
                ]}>
                <Text variant="callout" color={selected ? 'onTint' : 'text'} style={{ fontWeight: '600' }}>
                  {r}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.separator, { backgroundColor: theme.separator }]} />
        <Field
          label="Or type a relation"
          value={relation}
          onChangeText={setRelation}
          placeholder="e.g. Aunt"
          autoCapitalize="words"
          maxLength={40}
          editable={!saving}
        />
      </Section>

      {error && (
        <View accessibilityRole="alert" style={[styles.error, { backgroundColor: theme.backgroundElement }]}>
          <Icon name="exclamationmark.triangle" size={20} color={theme.danger} />
          <Text color="danger" style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      )}

      <Button title="Create" icon="person.badge.plus" onPress={create} loading={saving} disabled={!trimmed} />

      <Text variant="footnote" color="textSecondary" style={styles.note}>
        They don’t need the app. You can invite them to take over this profile later.
      </Text>
    </Screen>
  );
}

function HeaderButton({
  label,
  onPress,
  bold,
  disabled,
}: {
  label: string;
  onPress: () => void;
  bold?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={12}
      style={({ pressed }) => [styles.headerButton, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
      <Text variant={bold ? 'headline' : 'body'}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, padding: Spacing.three },
  chip: {
    minHeight: HitSize,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  error: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
    padding: Spacing.three,
    borderRadius: Radius.medium,
  },
  note: { paddingHorizontal: Spacing.three, textAlign: 'center' },
  // The web header has no side inset of its own.
  headerButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Platform.OS === 'web' ? Spacing.three : Spacing.one },
});
