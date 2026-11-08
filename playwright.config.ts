/**
 * Browser end-to-end tests: the production web build (`expo export`) against the local Supabase
 * stack, with the data API (cloudflare/) on local D1 + R2. Sign-in uses the real emailed code, read from the stack's mail catcher (Mailpit).
 *
 *   npx supabase start
 *   npm run e2e
 *
 * Keys come from `supabase status`, never from .env files, so these tests can't touch the real project.
 */
import { defineConfig, devices } from '@playwright/test';
import { execSync } from 'node:child_process';

const PORT = 8093;
const API_PORT = 8788;

function localStack() {
  // CI has the CLI installed globally; locally it runs through npx.
  const out = execSync('supabase status -o env || npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const env = Object.fromEntries(
    out
      .split(/\r?\n/)
      .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.API_URL ?? '')) {
    throw new Error(`E2E must run against a local Supabase, got API_URL=${env.API_URL}. Run: npx supabase start`);
  }
  return env;
}

const stack = localStack();
process.env.E2E_SUPABASE_URL = stack.API_URL;
process.env.E2E_SERVICE_ROLE_KEY = stack.SERVICE_ROLE_KEY;
process.env.E2E_MAILPIT_URL = stack.MAILPIT_URL ?? stack.INBUCKET_URL ?? 'http://127.0.0.1:54324';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // The product is used on iPhone Safari: run the phone layout in WebKit, plus Android Chrome.
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // Data API (cloudflare/) on local D1 + R2, trusting the local stack's tokens.
      command:
        'cd cloudflare && npx wrangler d1 migrations apply rx-vault --local && npx wrangler dev --port 8788 --ip 127.0.0.1' +
        ` --var SUPABASE_URL:${stack.API_URL} --var SUPABASE_JWT_SECRET:${stack.JWT_SECRET}` +
        ` --var SUPABASE_SERVICE_ROLE_KEY:${stack.SERVICE_ROLE_KEY} --var FILE_SIGNING_SECRET:e2e-file-secret`,
      url: `http://127.0.0.1:${API_PORT}/profiles`, // 401 counts as up
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `npx expo export --platform web --clear && node e2e/serve.mjs ${PORT}`,
      url: `http://localhost:${PORT}`,
      timeout: 300_000,
      reuseExistingServer: false,
      env: {
        EXPO_NO_DOTENV: '1',
        EXPO_PUBLIC_SUPABASE_URL: stack.API_URL,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: stack.ANON_KEY,
        EXPO_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
        EXPO_PUBLIC_OTP_LENGTH: '6',
      },
    },
  ],
});
