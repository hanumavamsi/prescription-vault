/**
 * Remembers an invite link opened while signed out, so we can show it right after sign-in.
 * Kept in SecureStore so it survives the app being killed during the sign-in flow.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'pending-invite-token';
let memory: string | null = null;

export async function setPendingInvite(token: string) {
  memory = token;
  await SecureStore.setItemAsync(KEY, token).catch(() => {});
}

export async function getPendingInvite(): Promise<string | null> {
  if (memory) return memory;
  try {
    memory = await SecureStore.getItemAsync(KEY);
  } catch {
    memory = null;
  }
  return memory;
}

export async function clearPendingInvite() {
  memory = null;
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
}
