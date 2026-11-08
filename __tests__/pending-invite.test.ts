/** The invite token must survive the sign-in round trip (native: SecureStore, web: localStorage). */
import * as native from '@/lib/pending-invite';
import * as web from '@/lib/pending-invite.web';

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  deleteItemAsync: async (k: string) => void mockSecure.delete(k),
}));

const local = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => void local.set(k, v),
    removeItem: (k: string) => void local.delete(k),
  },
});
const WEB_KEY = 'rxvault.pending-invite';

beforeEach(async () => {
  await native.clearPendingInvite();
  await web.clearPendingInvite();
  mockSecure.clear();
  local.clear();
});

describe('pending invite (native)', () => {
  it('reads a token saved before the app was killed', async () => {
    mockSecure.set('pending-invite-token', 'tok');
    await expect(native.getPendingInvite()).resolves.toBe('tok');
  });

  it('round-trips and clears', async () => {
    await native.setPendingInvite('tok');
    await expect(native.getPendingInvite()).resolves.toBe('tok');
    await native.clearPendingInvite();
    await expect(native.getPendingInvite()).resolves.toBeNull();
    expect(mockSecure.size).toBe(0);
  });
});

describe('pending invite (web)', () => {
  it('saves to localStorage and reads it back after a reload', async () => {
    await web.setPendingInvite('tok');
    const saved = local.get(WEB_KEY)!;
    expect(JSON.parse(saved).token).toBe('tok');
    await web.clearPendingInvite(); // drops the in-memory copy, as a reload would...
    local.set(WEB_KEY, saved); // ...while storage survives the Google redirect
    await expect(web.getPendingInvite()).resolves.toBe('tok');
  });

  it('forgets invites older than a day', async () => {
    local.set(WEB_KEY, JSON.stringify({ token: 'old', at: Date.now() - 25 * 60 * 60 * 1000 }));
    await expect(web.getPendingInvite()).resolves.toBeNull();
    expect(local.has(WEB_KEY)).toBe(false);
  });

  it('ignores corrupt storage', async () => {
    local.set(WEB_KEY, '{not json');
    await expect(web.getPendingInvite()).resolves.toBeNull();
    local.set(WEB_KEY, JSON.stringify({ token: 42, at: Date.now() }));
    await expect(web.getPendingInvite()).resolves.toBeNull();
  });
});
