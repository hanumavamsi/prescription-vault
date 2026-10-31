import { Stack, router } from 'expo-router';

import { Button, EmptyState, Screen } from '@/components/ui';

/** Shown for unknown links (old or mistyped deep links). */
export default function NotFound() {
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: 'Not found', headerBackButtonDisplayMode: 'minimal' }} />
      <EmptyState
        icon="link"
        title="This link doesn't work"
        message="The page may have moved, or the link is incomplete."
        action={
          <Button
            title="Go to my records"
            variant="secondary"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as never))}
          />
        }
      />
    </Screen>
  );
}
