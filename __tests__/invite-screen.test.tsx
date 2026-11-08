import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import InviteScreen from '@/app/invite/[token]';
import { acceptInvite, declineInvite, getInvite } from '@/lib/api';
import { setPendingInvite } from '@/lib/pending-invite';
import type { InvitePreview } from '@/lib/types';

const mockRouter = { canGoBack: jest.fn(() => true), back: jest.fn(), replace: jest.fn() };
const mockParams = { token: 'tok' as string | undefined };
const mockAuth = { session: { user: { id: 'me' } } as object | null };

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    get router() {
      return mockRouter; // getter: the factory runs before mockRouter is initialised
    },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => useEffect(() => cb(), [cb]),
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
    Stack: { Screen: () => null },
  };
});
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/lib/api', () => ({ getInvite: jest.fn(), acceptInvite: jest.fn(), declineInvite: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/pending-invite', () => ({ setPendingInvite: jest.fn(async () => {}) }));

const preview = (over: Partial<InvitePreview> = {}): InvitePreview => ({
  purpose: 'view',
  from_name: 'Asha',
  profile_name: null,
  valid: true,
  is_own: false,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.token = 'tok';
  mockAuth.session = { user: { id: 'me' } };
  mockRouter.canGoBack.mockReturnValue(true);
});

describe('<InviteScreen />', () => {
  it('signed out: remembers the token, then sends to sign-in', async () => {
    mockAuth.session = null;
    await render(<InviteScreen />);
    expect(await screen.findByText('redirect:/sign-in')).toBeTruthy();
    expect(setPendingInvite).toHaveBeenCalledWith('tok');
    expect(getInvite).not.toHaveBeenCalled();
  });

  it('approves a view request and closes', async () => {
    jest.mocked(getInvite).mockResolvedValue(preview());
    await render(<InviteScreen />);
    expect(await screen.findByText('Asha wants to view your health records')).toBeTruthy();
    fireEvent.press(screen.getByText('Approve'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(acceptInvite).toHaveBeenCalledWith('tok');
  });

  it('declines a profile handover and goes home on a cold start', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    jest.mocked(getInvite).mockResolvedValue(preview({ purpose: 'claim', profile_name: 'Ravi' }));
    await render(<InviteScreen />);
    expect(await screen.findByText("Asha is handing over Ravi's profile")).toBeTruthy();
    fireEvent.press(screen.getByText('Decline'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(declineInvite).toHaveBeenCalledWith('tok');
  });

  it('explains an invite that expired between opening and accepting', async () => {
    jest.mocked(getInvite).mockResolvedValue(preview());
    jest.mocked(acceptInvite).mockRejectedValue(new Error('invite expired'));
    await render(<InviteScreen />);
    fireEvent.press(await screen.findByText('Approve'));
    expect(await screen.findByText('This invite has expired or was already used. Ask for a new link.')).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'Invite not found'],
    [preview({ is_own: true }), 'This is your own invite'],
    [preview({ valid: false }), 'Invite expired'],
  ])('shows a dead end without accept/decline (%#)', async (inv, title) => {
    jest.mocked(getInvite).mockResolvedValue(inv);
    await render(<InviteScreen />);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Decline')).toBeNull();
  });
});
