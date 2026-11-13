import type { TelemetryEvent } from '@/features/telemetry';

/**
 * Box Office, the portfolio's web analytics, on everything that is not the web.
 *
 * Deliberately nothing. Box Office is a script tag in `public/index.html`, so
 * it only exists in a browser, and the native apps must not start sending
 * anything new without an App Privacy label that says so. The web twin,
 * `boxoffice.web.ts`, is the one Metro picks for the browser build; this file
 * is what iOS and Android (and the tests) get, so the native bundle's
 * behaviour cannot change because of it.
 */
export function forwardToBoxOffice(_event: TelemetryEvent): void {}
