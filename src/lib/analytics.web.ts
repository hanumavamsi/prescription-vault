/**
 * Product analytics and error reporting via PostHog (web only; native is analytics.ts, a no-op).
 * Off unless EXPO_PUBLIC_POSTHOG_KEY is set. Health app: no autocapture, no session replay, and
 * only the Supabase user id is sent, never names, emails or document contents.
 */
import { posthog, type CaptureResult } from 'posthog-js';

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

/**
 * Strips query and fragment (OAuth #access_token / ?code, invite ?token) and invite path tokens
 * from URL-like strings. UTM params are read by PostHog into their own properties first.
 */
export function scrubUrl(value: string): string {
  if (!/^(https?:\/\/|\/)/.test(value)) return value;
  return value.replace(/[?#].*$/, '').replace(/\/invite\/[^/]+/g, '/invite/:token');
}

function scrub(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  for (const bag of [event.properties, event.$set, event.$set_once]) {
    if (!bag) continue;
    for (const k of Object.keys(bag)) if (typeof bag[k] === 'string') bag[k] = scrubUrl(bag[k]);
  }
  return event;
}

if (KEY && typeof window !== 'undefined') {
  posthog.init(KEY, {
    api_host: HOST,
    defaults: '2026-08-30', // SPA pageviews on history change, referrer + UTM + geo on each
    autocapture: false, // button labels could include document titles
    disable_session_recording: true,
    capture_exceptions: true,
    person_profiles: 'identified_only',
    before_send: scrub,
  });
}

export function identify(userId: string) {
  if (KEY) posthog.identify(userId);
}

export function resetAnalytics() {
  if (KEY) posthog.reset();
}

/** Product event. Keep properties to counts and enums; never titles, names or notes. */
export function track(event: string, props?: Record<string, string | number | boolean>) {
  if (KEY) posthog.capture(event, props);
}

export function captureError(error: unknown) {
  if (KEY) posthog.captureException(error);
}
