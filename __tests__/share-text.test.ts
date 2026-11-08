/** Web invite sharing: share sheet, else clipboard, else an error that carries the link. */
import { copyText, shareText } from '@/lib/share.web';

const nav = globalThis.navigator as unknown as Record<string, unknown>;
const original = { share: nav.share, clipboard: nav.clipboard };

function setNav(share?: jest.Mock, writeText?: jest.Mock) {
  Object.defineProperty(nav, 'share', { configurable: true, value: share });
  Object.defineProperty(nav, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
}

afterEach(() => {
  Object.defineProperty(nav, 'share', { configurable: true, value: original.share });
  Object.defineProperty(nav, 'clipboard', { configurable: true, value: original.clipboard });
});

const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
const notAllowed = Object.assign(new Error('expired tap'), { name: 'NotAllowedError' });

describe('shareText (web)', () => {
  it('uses the share sheet when available', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    setNav(share);
    await expect(shareText('Join me https://x/invite/t', 'https://x/invite/t')).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: 'Join me https://x/invite/t' });
  });

  it('reports a cancelled share sheet as dismissed, without copying', async () => {
    const writeText = jest.fn();
    setNav(jest.fn().mockRejectedValue(abort), writeText);
    await expect(shareText('m', 'u')).resolves.toBe('dismissed');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when sharing is refused or missing', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNav(jest.fn().mockRejectedValue(notAllowed), writeText);
    await expect(shareText('m', 'u')).resolves.toBe('copied');
    setNav(undefined, writeText);
    await expect(shareText('m', 'u')).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('m');
  });

  it('throws with the link when nothing works', async () => {
    setNav(undefined, jest.fn().mockRejectedValue(new Error('denied')));
    await expect(shareText('m', 'https://x/invite/t')).rejects.toThrow('https://x/invite/t');
  });
});

describe('copyText (web)', () => {
  it('returns false when the clipboard is blocked', async () => {
    setNav(undefined, jest.fn().mockRejectedValue(new Error('denied')));
    await expect(copyText('m')).resolves.toBe(false);
  });
});
