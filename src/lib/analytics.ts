/** Native: analytics are off for now (web app is the product). Web: analytics.web.ts. */
export function identify(_userId: string) {}
export function resetAnalytics() {}
export function track(_event: string, _props?: Record<string, string | number | boolean>) {}
export function captureError(_error: unknown) {}
