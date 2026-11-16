import type { TelemetryEvent } from '@/features/telemetry';

/**
 * Box Office, on Android (and under the tests): nothing.
 *
 * The web build gets `boxoffice.web.ts` (the loader's queue) and iOS gets
 * `boxoffice.ios.ts` (the native sender, from 1.1.0, with its App Store label).
 * Android sends nothing until Google Play's Data safety form says it does and
 * the owner says yes for it; this file is what keeps that true.
 */
export function forwardToBoxOffice(_event: TelemetryEvent): void {}

/** No "Share usage stats" row where nothing is shared. */
export const usageStatsSupported = false;
export async function usageStatsOn(): Promise<boolean> {
  return false;
}
export async function setUsageStats(_on: boolean): Promise<boolean> {
  return false;
}
