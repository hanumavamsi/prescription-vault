import * as Sentry from '@sentry/react-native';

/**
 * Crash reporting. Health data must never leave the device in a report, so events keep only the
 * error type and stack; messages are scrubbed and breadcrumbs, user, request and extras dropped.
 */

/** Replaces anything in an error message that could be a person's data or a secret. */
export function scrubText(text: string): string {
  return text
    .replace(/[^\s@'"<>]+@[^\s@'"<>]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi, '[url]')
    .replace(/(["'`‘“]).*?(["'`’”])/g, '$1[redacted]$2') // quoted titles, notes, names
    .replace(/[^\s/\\'"]+\.(pdf|jpe?g|png|heic|webp|gif)\b/gi, '[file]')
    .replace(/[A-Za-z0-9_-]{20,}(\.[A-Za-z0-9_-]+)*/g, '[token]'); // ids, JWTs, invite tokens
}

export function scrubEvent<T extends Sentry.Event>(event: T): T {
  delete event.user;
  delete event.request; // page URL (invite tokens, auth fragments), headers, bodies
  delete event.extra;
  delete event.breadcrumbs;
  if (event.message) event.message = scrubText(event.message);
  if (event.logentry?.message) event.logentry = { message: scrubText(event.logentry.message) };
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  return event;
}

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initSentry() {
  if (!dsn) return; // dev, tests and builds without the variable report nothing
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Breadcrumbs carry URLs, console output and tapped text (record titles): keep none.
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
  });
}

export function reportError(error: unknown) {
  if (dsn) Sentry.captureException(error);
}
