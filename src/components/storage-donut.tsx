import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { formatBytes, Text } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { getStorageUsage } from '@/lib/api';

const SIZE = 28;
const STROKE = 5;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/** Cloud storage used (own + managed profiles) as a small donut; taps through to Settings. */
export function StorageDonut() {
  const theme = useTheme();
  const usage = useQuery(getStorageUsage);
  if (!usage.data) return null;
  const { used, quota } = usage.data;
  const full = used >= quota;
  const fraction = Math.min(1, quota > 0 ? used / quota : 1);
  const label = `${formatBytes(used)} of ${formatBytes(quota)} used`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Cloud storage: ${label}`}
      accessibilityHint="Opens Settings"
      onPress={() => router.push('/settings' as Href)}
      hitSlop={8}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={theme.backgroundSelected} strokeWidth={STROKE} fill="none" />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={full ? theme.danger : theme.tint}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={`${C * fraction} ${C}`}
          // Start the arc at 12 o'clock.
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <Text variant="footnote" color={full ? 'danger' : 'textSecondary'}>
        {formatBytes(used)} / {formatBytes(quota)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2, marginLeft: 'auto' },
});
