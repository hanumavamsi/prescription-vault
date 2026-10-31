import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ios = Platform.OS === 'ios';

export default function AppLayout() {
  const theme = useTheme();
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
        name="profile/new"
        options={{ title: 'New profile', presentation: 'modal', headerLargeTitleEnabled: false }}
      />
    </Stack>
  );
}
