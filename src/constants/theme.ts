/**
 * Minimal monochrome palette with an iOS-native feel.
 * One accent: the text color itself (black in light, white in dark). Red only for destructive actions.
 * The role colors only mark who a profile belongs to (me / shared with me / managed by me).
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    textSecondary: '#6B6B70',
    textTertiary: '#A1A1A6',
    background: '#F2F2F7', // grouped background
    backgroundElement: '#FFFFFF', // cards, rows
    backgroundSelected: '#E5E5EA',
    separator: '#D1D1D6',
    tint: '#000000',
    onTint: '#FFFFFF',
    danger: '#D70015',
    // Who a profile is to me: rings on avatars plus a legend, so they're never colour-only.
    roleSelf: '#0071E3',
    roleShared: '#248A3D',
    roleManaged: '#C93400',
  },
  dark: {
    text: '#FFFFFF',
    textSecondary: '#A1A1A6',
    textTertiary: '#6B6B70',
    background: '#000000',
    backgroundElement: '#1C1C1E',
    backgroundSelected: '#2C2C2E',
    separator: '#38383A',
    tint: '#FFFFFF',
    onTint: '#000000',
    danger: '#FF453A',
    roleSelf: '#0A84FF',
    roleShared: '#30D158',
    roleManaged: '#FF9F0A',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type Palette = { [K in ThemeColor]: string };

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/** Type scale. Sizes are generous on purpose: many users are elderly. Dynamic Type scales these further. */
export const Type = {
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.4 },
  title: { fontSize: 28, fontWeight: '700' },
  title2: { fontSize: 22, fontWeight: '600' },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 17, fontWeight: '400' },
  callout: { fontSize: 16, fontWeight: '400' },
  footnote: { fontSize: 13, fontWeight: '400' },
  caption: { fontSize: 12, fontWeight: '500', letterSpacing: 0.3 },
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 8,
  medium: 12,
  large: 16,
  full: 999,
} as const;

/** Minimum touch target. */
export const HitSize = 48;

export const MaxContentWidth = 800;
