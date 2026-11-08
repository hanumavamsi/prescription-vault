import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { Waitlist } from '@/components/waitlist';
import { Type } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { isApproved } from '@/lib/api';

const ios = Platform.OS === 'ios';

/**
 * Keep Home under every screen. Without this, a screen opened straight from a URL, a browser
 * refresh or a link is alone in the stack and has no back button.
 */
export const unstable_settings = { anchor: 'index' };

export default function AppLayout() {
  const theme = useTheme();
  // Rechecked on focus, so accepting an invite (opened on top) lets a waitlisted user straight in.
  // Unknown (loading/offline) shows the app; the database refuses writes from waitlisted users anyway.
  const approved = useQuery(isApproved);
  if (approved.data === false) return <Waitlist onCheckAgain={approved.refresh} />;
  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.text,
        headerStyle: { backgroundColor: theme.background },
        headerTitleStyle: { color: theme.text, fontSize: Type.headline.fontSize, fontWeight: Type.headline.fontWeight },
        headerLargeTitleStyle: { color: theme.text },
        headerLargeStyle: { backgroundColor: theme.background },
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        // Web defaults to left-aligned titles, which crowd the modals' Cancel button; match iOS.
        ...(Platform.OS === 'web' && { headerTitleAlign: 'center' as const }),
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="index" options={{ title: 'Rx Vault', headerLargeTitleEnabled: ios }} />
      <Stack.Screen name="person/[id]" options={{ title: '', headerLargeTitleEnabled: ios }} />
      <Stack.Screen name="document/[id]" options={{ title: '' }} />
      <Stack.Screen name="profile/[id]" options={{ title: 'Profile' }} />
      <Stack.Screen name="family" options={{ title: 'Family', headerLargeTitleEnabled: ios }} />
      <Stack.Screen name="settings" options={{ title: 'Settings', headerLargeTitleEnabled: ios }} />
      <Stack.Screen
        name="add"
        options={{ title: 'Add document', presentation: 'modal', headerLargeTitleEnabled: false }}
      />
      <Stack.Screen
        name="add-person"
        options={{ title: 'Add a person', presentation: 'modal', headerLargeTitleEnabled: false }}
      />
      <Stack.Screen
        name="profile/new"
        options={{ title: 'New profile', presentation: 'modal', headerLargeTitleEnabled: false }}
      />
    </Stack>
  );
}
