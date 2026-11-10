import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SignInScreen from '@/app/sign-in';

const mockRuntime = { turnstileSiteKey: undefined as string | undefined };
const mockRequestEmailCode = jest.fn(async (_email: string, _captchaToken?: string) => {});

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: async () => false }));
jest.mock('@/lib/runtime', () => ({
  isWeb: true,
  isExpoGo: false,
  googleWebEnabled: false,
  devEmailLogin: false,
  otpLength: 6,
  get turnstileSiteKey() {
    return mockRuntime.turnstileSiteKey;
  },
}));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    signInWithApple: jest.fn(),
    signInWithGoogle: jest.fn(),
    signInWithGoogleCredential: jest.fn(),
    requestEmailCode: mockRequestEmailCode,
    verifyEmailCode: jest.fn(),
    signInWithEmail: jest.fn(),
  }),
}));
// Stand-in widget: hands out a fresh token on mount and on every reset.
jest.mock('@/components/turnstile', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    Turnstile: ({ onToken, resetKey = 0 }: { onToken(t: string | null): void; resetKey?: number }) => {
      useEffect(() => onToken(`tok-${resetKey}`), [onToken, resetKey]);
      return null;
    },
  };
});

async function sendCode() {
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByLabelText(/I agree to the Terms/));
  await fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'a@b.co');
  await fireEvent.press(screen.getByText('Email me a sign-in code'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRuntime.turnstileSiteKey = undefined;
});

describe('sign-in captcha', () => {
  it('sends no token when no site key is set', async () => {
    await sendCode();
    await waitFor(() => expect(mockRequestEmailCode).toHaveBeenCalledWith('a@b.co', undefined));
  });

  it('sends the Turnstile token when a site key is set, and a fresh one on retry', async () => {
    mockRuntime.turnstileSiteKey = 'site-key';
    mockRequestEmailCode.mockRejectedValueOnce(new Error('Could not send the code.'));
    await sendCode();
    await waitFor(() => expect(mockRequestEmailCode).toHaveBeenCalledWith('a@b.co', 'tok-0'));
    expect(await screen.findByText('Could not send the code.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Email me a sign-in code'));
    await waitFor(() => expect(mockRequestEmailCode).toHaveBeenLastCalledWith('a@b.co', 'tok-1'));
  });
});
