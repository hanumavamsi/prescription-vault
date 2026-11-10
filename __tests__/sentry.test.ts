import type { ErrorEvent } from '@sentry/react-native';

import { scrubEvent, scrubText } from '@/lib/sentry';

// The SDK ships ESM that Jest can't load; the scrubber doesn't need it.
jest.mock('@sentry/react-native', () => ({}));

describe('scrubText', () => {
  it('removes emails, URLs, quoted text, file names and tokens', () => {
    expect(scrubText('No user jane.doe+1@gmail.com')).toBe('No user [email]');
    expect(scrubText('GET https://x.supabase.co/storage/v1/a.pdf?token=abc failed')).toBe('GET [url] failed');
    expect(scrubText('Cannot save "Dad - HbA1c 7.2"')).toBe('Cannot save "[redacted]"');
    expect(scrubText('Upload of blood test.pdf failed')).toBe('Upload of blood [file] failed');
    expect(scrubText('Invalid invite 3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b')).toBe('Invalid invite [token]');
    expect(scrubText('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc')).toBe('jwt [token]');
  });

  it('keeps ordinary error text', () => {
    expect(scrubText("TypeError: Cannot read properties of undefined (reading 'map')")).toBe(
      "TypeError: Cannot read properties of undefined (reading '[redacted]')",
    );
    expect(scrubText('Network request failed')).toBe('Network request failed');
  });
});

describe('scrubEvent', () => {
  it('drops user, request, extras and breadcrumbs and scrubs messages', () => {
    const event = {
      type: undefined,
      message: 'for a@b.co',
      user: { email: 'a@b.co' },
      request: { url: 'https://rx-vault.expo.app/invite/secret', data: 'body' },
      extra: { record: 'notes' },
      breadcrumbs: [{ message: 'tapped "Mom MRI"' }],
      exception: { values: [{ type: 'Error', value: 'bad file scan.jpg', stacktrace: { frames: [{ function: 'save' }] } }] },
    } as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.user).toBeUndefined();
    expect(out.request).toBeUndefined();
    expect(out.extra).toBeUndefined();
    expect(out.breadcrumbs).toBeUndefined();
    expect(out.message).toBe('for [email]');
    expect(out.exception?.values?.[0]).toEqual({ type: 'Error', value: 'bad file [file]', stacktrace: { frames: [{ function: 'save' }] } });
  });
});
