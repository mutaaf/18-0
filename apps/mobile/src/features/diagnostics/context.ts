import { Platform } from 'react-native';
import { DEFAULT_SCORING_CONFIG } from '@17-0/domain';
import { flag } from '@/features/flags';
import { deviceProps } from './device';

/**
 * What every diagnostic report says about where it came from.
 *
 * The questions a report has to answer before it can be fixed are "which
 * build", "which screen" and "which variant", and none of them is about the
 * player. So that is all this carries: the marketing version and the build, the
 * route *pattern* (`card/[id]`, never the id), the scoring model, and -- added
 * by `analytics.ts` on every event -- the platform and the `$feature/<key>`
 * variants.
 */

// Moved to `device.ts`, which `analytics.ts` can import without a cycle
// through the flags; re-exported because `tv/jank.ts` reads it from here.
export { buildId } from './device';

let route = 'boot';

/** Set by the root layout on every navigation. A pattern, not a path. */
export function setRoute(next: string): void {
  route = next || 'index';
}

export function currentRoute(): string {
  return route;
}

/** The properties a diagnostic event adds to what `track()` and `analytics.ts` already add. */
export function context(): Record<string, string> {
  return {
    app_version: deviceProps().app_version,
    build: deviceProps().build,
    route,
    scoring_version: DEFAULT_SCORING_CONFIG.version,
  };
}

/**
 * Whether a browser has asked not to be measured.
 *
 * Global Privacy Control and Do Not Track are honoured by Box Office on this
 * site already (privacy.html says "nothing is recorded or sent"), and a new
 * category of data is not the place to start ignoring them. Native apps have
 * no such signal; there the App Privacy label and the flag are the controls.
 */
export function privacySignal(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
  const win = typeof window !== 'undefined' ? (window as unknown as { doNotTrack?: string | null }) : null;
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || win?.doNotTrack === '1';
}

/**
 * The one gate every diagnostic event passes.
 *
 * `diagnostics` is a kill switch rather than a rollout: if an error loop ever
 * spends the PostHog quota, or a store asks, this stops every report on every
 * device that can reach PostHog without a release. Read through `flag()` like
 * every other flag, so the operator console shows it and can override it.
 */
export function diagnosticsAllowed(): boolean {
  return flag('diagnostics') && !privacySignal();
}
