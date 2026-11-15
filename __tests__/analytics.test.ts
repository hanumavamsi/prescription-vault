import { scrubUrl } from '@/lib/analytics.web';

jest.mock('posthog-js', () => ({ posthog: {} })); // its import touches browser APIs

describe('scrubUrl', () => {
  it('drops invite tokens, query and fragment from URLs', () => {
    expect(scrubUrl('https://rx-vault.expo.app/invite/abc123?x=1')).toBe('https://rx-vault.expo.app/invite/:token');
    expect(scrubUrl('https://rx-vault.expo.app/#access_token=secret')).toBe('https://rx-vault.expo.app/');
    expect(scrubUrl('/?token=abc')).toBe('/');
    expect(scrubUrl('/document/42')).toBe('/document/42');
  });

  it('leaves non-URL strings alone', () => {
    expect(scrubUrl('Item #3 failed?')).toBe('Item #3 failed?');
  });
});
