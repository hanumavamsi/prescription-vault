import { installPlatform } from '@/components/install-hint';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

test('shows on phone browsers, not on desktop or from the Home Screen', () => {
  expect(installPlatform(IPHONE, 5, false)).toBe('ios');
  expect(installPlatform(IPAD, 5, false)).toBe('ios');
  expect(installPlatform(IPAD, 0, false)).toBeNull(); // a real Mac
  expect(installPlatform(ANDROID, 5, false)).toBe('android');
  expect(installPlatform(WINDOWS, 0, false)).toBeNull();
  expect(installPlatform(IPHONE, 5, true)).toBeNull();
  expect(installPlatform(ANDROID, 5, true)).toBeNull();
});
