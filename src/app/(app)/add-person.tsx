import { router, Stack, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Screen, Text, roleColorKey, type IconName } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ProfileRole } from '@/lib/types';

/** Home's "Add" bubble: ask an app user to share their records, or add someone without the app. */
export default function AddPerson() {
  return (
    <Screen>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={() => router.back()}
              hitSlop={12}
              style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.6 }]}>
              <Text>Cancel</Text>
            </Pressable>
          ),
        }}
      />
      <Option
        role="viewer"
        icon="paperplane"
        title="Request to see their records"
        message="For someone who already uses Rx Vault, like a parent. They get a link and choose to approve. You can view only."
        onPress={() => router.replace('/family' as Href)}
      />
      <Option
        role="managed"
        icon="person.badge.plus"
        title="Add someone you manage"
        message="For a child or an elder who doesn't use the app. You add and keep their prescriptions and reports."
        onPress={() => router.replace('/profile/new' as Href)}
      />
    </Screen>
  );
}

function Option({
  role,
  icon,
  title,
  message,
  onPress,
}: {
  role: ProfileRole;
  icon: IconName;
  title: string;
  message: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = theme[roleColorKey[role]];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={message}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement, borderLeftColor: color },
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}>
      <View style={[styles.icon, { backgroundColor: color }]}>
        <Icon name={icon} size={22} color="#FFFFFF" />
      </View>
      <View style={styles.body}>
        <Text variant="headline">{title}</Text>
        <Text color="textSecondary">{message}</Text>
      </View>
      <Icon name="chevron.right" size={14} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderLeftWidth: 4,
  },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: Spacing.one },
  headerButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
});
