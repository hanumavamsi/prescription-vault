/**
 * Shared UI primitives. Screens compose these instead of styling from scratch,
 * so the whole app keeps one look.
 */
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextProps as RNTextProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HitSize, MaxContentWidth, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ProfileRole } from '@/lib/types';

// ------------------------------------------------------------------ Text

type TextProps = RNTextProps & {
  variant?: keyof typeof Type;
  color?: 'text' | 'textSecondary' | 'textTertiary' | 'danger' | 'onTint';
};

export function Text({ variant = 'body', color = 'text', style, ...rest }: TextProps) {
  const theme = useTheme();
  return <RNText style={[Type[variant], { color: theme[color] }, style]} maxFontSizeMultiplier={1.8} {...rest} />;
}

// ------------------------------------------------------------------ Screen

/** Scrollable page body on the grouped background, centered on wide screens. */
export function Screen({ children, contentContainerStyle, ...rest }: ScrollViewProps & { children: ReactNode }) {
  const theme = useTheme();
  const webBottom = useWebBottomInset();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.screen, webBottom > 0 && { paddingBottom: Spacing.six + webBottom }, contentContainerStyle]}
      {...rest}>
      {children}
    </ScrollView>
  );
}

/**
 * Web only: the iPhone home-indicator inset when running as a home-screen app (viewport-fit=cover).
 * Native scroll views already get it from contentInsetAdjustmentBehavior, so this is 0 there.
 */
export function useWebBottomInset() {
  const { bottom } = useSafeAreaInsets();
  return Platform.OS === 'web' ? bottom : 0;
}

// ------------------------------------------------------------------ Icon

/** SF Symbol names used in the app, each with its Material Symbol equivalent for Android. */
const ANDROID_ICONS = {
  'arrow.uturn.backward': 'undo',
  'arrow.up.left.and.arrow.down.right': 'open_in_full',
  'arrow.up.right.square': 'open_in_new',
  checkmark: 'check',
  'checkmark.square.fill': 'check_box',
  'chevron.right': 'chevron_right',
  'cross.case.fill': 'medical_services',
  'doc.plaintext': 'article',
  'doc.richtext': 'picture_as_pdf',
  'doc.text': 'description',
  'doc.viewfinder': 'document_scanner',
  envelope: 'mail',
  'exclamationmark.triangle': 'warning',
  'exclamationmark.triangle.fill': 'warning',
  eye: 'visibility',
  'eye.slash': 'visibility_off',
  faceid: 'fingerprint',
  gearshape: 'settings',
  'hand.raised': 'shield',
  'info.circle': 'info',
  internaldrive: 'storage',
  link: 'link',
  lock: 'lock',
  magnifyingglass: 'search',
  'lock.doc': 'lock',
  'lock.fill': 'lock',
  paperplane: 'send',
  pencil: 'edit',
  'person.2': 'group',
  'person.badge.plus': 'person_add',
  'person.crop.circle': 'account_circle',
  'person.crop.circle.badge.checkmark': 'how_to_reg',
  'person.crop.circle.badge.exclamationmark': 'person_alert',
  'person.crop.circle.badge.xmark': 'person_remove',
  'photo.on.rectangle': 'photo_library',
  pills: 'medication',
  plus: 'add',
  'rectangle.portrait.and.arrow.right': 'logout',
  square: 'check_box_outline_blank',
  'square.and.arrow.up': 'share',
  trash: 'delete',
  tray: 'inbox',
  xmark: 'close',
  'xmark.circle.fill': 'cancel',
} as const satisfies Partial<Record<SFSymbol, AndroidSymbol>>;

export type IconName = keyof typeof ANDROID_ICONS;

/** SF Symbol on iOS, the mapped Material Symbol on Android. Decorative: label the control, not the icon. */
export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const theme = useTheme();
  return (
    <SymbolView
      name={{ ios: name, android: ANDROID_ICONS[name], web: ANDROID_ICONS[name] }}
      size={size}
      tintColor={color ?? theme.text}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

// ------------------------------------------------------------------ Button

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'plain' | 'destructive';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, accessibilityHint }: ButtonProps) {
  const theme = useTheme();
  const bg =
    variant === 'primary' ? theme.tint : variant === 'secondary' ? theme.backgroundElement : 'transparent';
  const fg =
    variant === 'primary' ? theme.onTint : variant === 'destructive' ? theme.danger : theme.text;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: isDisabled ? 0.4 : pressed ? 0.7 : 1 },
        variant === 'secondary' && { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.separator },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size={20} color={fg} />}
          <RNText style={[Type.headline, { color: fg }]} maxFontSizeMultiplier={1.6}>
            {title}
          </RNText>
        </>
      )}
    </Pressable>
  );
}

// ------------------------------------------------------------------ Grouped list

export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      {title && (
        <Text variant="footnote" color="textSecondary" style={styles.sectionTitle}>
          {title.toUpperCase()}
        </Text>
      )}
      <View style={[styles.group, { backgroundColor: theme.backgroundElement }]}>{children}</View>
      {footer && (
        <Text variant="footnote" color="textSecondary" style={styles.sectionFooter}>
          {footer}
        </Text>
      )}
    </View>
  );
}

type RowProps = {
  title: string;
  subtitle?: string;
  value?: string;
  left?: ReactNode;
  icon?: IconName;
  onPress?: () => void;
  destructive?: boolean;
  chevron?: boolean;
  last?: boolean;
  right?: ReactNode;
};

export function Row({ title, subtitle, value, left, icon, onPress, destructive, chevron = !!onPress, last, right }: RowProps) {
  const theme = useTheme();
  const content = (
    <View style={styles.row}>
      {left ?? (icon && <Icon name={icon} size={22} color={destructive ? theme.danger : theme.text} />)}
      <View
        style={[
          styles.rowBody,
          !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator },
        ]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text color={destructive ? 'danger' : 'text'} numberOfLines={1}>
            {title}
          </Text>
          {subtitle && (
            <Text variant="footnote" color="textSecondary" numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        {value && <Text color="textSecondary">{value}</Text>}
        {right}
        {chevron && <Icon name="chevron.right" size={14} color={theme.textTertiary} />}
      </View>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => pressed && { backgroundColor: theme.backgroundSelected }}>
      {content}
    </Pressable>
  );
}

// ------------------------------------------------------------------ Avatar

/** Who a profile is to me, as shown on avatars and in the legend. */
export const roleColorKey = { self: 'roleSelf', viewer: 'roleShared', managed: 'roleManaged' } as const satisfies Record<
  ProfileRole,
  keyof ReturnType<typeof useTheme>
>;
export const roleLabel = { self: 'Me', viewer: 'Shared with me', managed: 'Managed by me' } as const satisfies Record<
  ProfileRole,
  string
>;

export function Avatar({
  name,
  size = 48,
  dashed,
  role,
}: {
  name: string;
  size?: number;
  dashed?: boolean;
  /** Draws a coloured ring for the profile's role. */
  role?: ProfileRole;
}) {
  const theme = useTheme();
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const ring = role ? theme[roleColorKey[role]] : undefined;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: dashed ? 'transparent' : theme.backgroundSelected,
        borderWidth: dashed ? 1.5 : ring ? Math.max(2, Math.round(size / 20)) : 0,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: ring ?? theme.textTertiary,
      }}>
      <RNText style={{ fontSize: size * 0.38, fontWeight: '600', color: theme.text }} allowFontScaling={false}>
        {initials || '?'}
      </RNText>
    </View>
  );
}

// ------------------------------------------------------------------ Field

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text variant="footnote" color="textSecondary">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textTertiary}
        style={[Type.body, styles.input, { color: theme.text }]}
        maxFontSizeMultiplier={1.8}
        {...props}
      />
    </View>
  );
}

// ------------------------------------------------------------------ SearchField

/** Rounded search box with a clear button. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: theme.backgroundSelected }]}>
      <Icon name="magnifyingglass" size={18} color={theme.textSecondary} />
      <TextInput
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        maxFontSizeMultiplier={1.8}
        style={[Type.body, styles.searchInput, { color: theme.text }]}
      />
      {value.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          hitSlop={10}
          style={({ pressed }) => [styles.searchClear, pressed && { opacity: 0.5 }]}>
          <Icon name="xmark.circle.fill" size={18} color={theme.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ Chip

export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.tint : theme.backgroundSelected,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}>
      <Text variant="callout" color={selected ? 'onTint' : 'text'} style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ Segmented

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: theme.backgroundSelected }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && { backgroundColor: theme.backgroundElement }]}>
            <Text variant="callout" style={{ fontWeight: active ? '600' : '400' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ States

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={44} color={theme.textTertiary} />
      <Text variant="title2" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {message && (
        <Text color="textSecondary" style={{ textAlign: 'center' }}>
          {message}
        </Text>
      )}
      {action}
    </View>
  );
}

export function Loading() {
  const theme = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: theme.background }]}>
      <ActivityIndicator color={theme.text} />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="exclamationmark.triangle"
      title="Something went wrong"
      message={message}
      action={onRetry && <Button title="Try again" variant="secondary" onPress={onRetry} />}
    />
  );
}

// ------------------------------------------------------------------ helpers

export function formatDate(iso: string) {
  // doc_date is a plain YYYY-MM-DD; parse as local date to avoid timezone shifts.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const docTypeLabel = { prescription: 'Prescription', report: 'Report' } as const;
export const docTypeIcon = { prescription: 'pills', report: 'doc.text' } as const satisfies Record<string, IconName>;

const styles = StyleSheet.create({
  screen: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  button: {
    minHeight: HitSize + 4,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  section: { gap: Spacing.two },
  sectionTitle: { paddingHorizontal: Spacing.three },
  sectionFooter: { paddingHorizontal: Spacing.three },
  group: { borderRadius: Radius.medium, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing.three,
    gap: Spacing.three,
    minHeight: HitSize + 8,
  },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingVertical: Spacing.two + 2,
    paddingRight: Spacing.three,
    gap: Spacing.two,
  },
  field: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + 2, gap: Spacing.one },
  input: { minHeight: 32, paddingVertical: Platform.select({ android: 0, default: 4 }) },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: HitSize,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
  },
  searchInput: { flex: 1, minHeight: HitSize, paddingVertical: 0 },
  searchClear: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  chip: {
    minHeight: HitSize,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: { flexDirection: 'row', borderRadius: Radius.small + 1, padding: 2 },
  segment: { flex: 1, minHeight: HitSize - 4, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.small },
  empty: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.six, paddingHorizontal: Spacing.four },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
