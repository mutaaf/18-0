/**
 * When the What's New sheet shows. Pure, so the rules are tested rather than
 * remembered; the storage and the version lookup live in `index.ts`.
 *
 *   - Once per version, after an update. The version is recorded the moment
 *     the sheet is shown, not when it is dismissed: an app killed with the
 *     sheet open has still been told.
 *   - Never on a fresh install. Somebody who has just downloaded the game has
 *     no "before" for anything to be new against -- the same reason Apple
 *     refuses release notes on a first version. Their first launch records the
 *     version as seen and shows nothing.
 *   - A player from before this sheet existed has no record at all, which
 *     looks exactly like a fresh install. Their saved seasons are what tell
 *     them apart, so a device with history and no record counts as an update.
 *   - Never going backwards (a TestFlight build older than the store one), and
 *     never for a version with no notes written.
 *   - Never when suppressed: tests, store capture, demos, automation. A
 *     suppressed launch records nothing either, so a capture session does not
 *     use up a real player's sheet on a shared device.
 */

export interface WhatsNewInput {
  /** The running marketing version. */
  readonly current: string | null;
  /** The version last recorded as seen, or null if nothing ever was. */
  readonly seen: string | null;
  /** Whether this device has played before (saved seasons exist). */
  readonly hasHistory: boolean;
  /** Whether notes exist for `current`. */
  readonly hasNotes: boolean;
  readonly suppressed: boolean;
}

export interface WhatsNewDecision {
  readonly show: boolean;
  /** The version to record as seen, or null to leave storage alone. */
  readonly record: string | null;
}

const NOTHING: WhatsNewDecision = { show: false, record: null };

export function decideWhatsNew(input: WhatsNewInput): WhatsNewDecision {
  const { current, seen, hasHistory, hasNotes, suppressed } = input;
  if (suppressed || !current) return NOTHING;
  if (seen === current) return NOTHING;

  // Fresh install: remember where this player started, show nothing.
  if (seen === null && !hasHistory) return { show: false, record: current };

  // Downgrade: keep the newer record, so the sheet still shows on the way back up.
  if (seen !== null && compareVersions(current, seen) < 0) return NOTHING;

  return { show: hasNotes, record: current };
}

/** `major.minor.patch`, numerically. A missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Everything that means "a person did not just open an updated app".
 *
 * The repository had no capture or demo switch of its own: the store
 * screenshots and `verify:fold` drive a fresh headless browser, which a fresh
 * install already covers. These name the cases that are not fresh:
 *
 *   - a test runner (vitest sets `VITEST`; Jest and friends set NODE_ENV=test);
 *   - a browser driven by automation (`navigator.webdriver`, which Puppeteer,
 *     Playwright and Selenium all set) -- a harness with a warm profile;
 *   - `?capture`, `?demo` or `?nowhatsnew` on the web address, for a person
 *     recording the game by hand.
 */
export interface SuppressionEnv {
  readonly nodeEnv?: string;
  readonly vitest?: string;
  readonly webdriver?: boolean;
  readonly search?: string;
}

export const SUPPRESS_PARAMS = ['capture', 'demo', 'nowhatsnew'] as const;

export function isSuppressed(env: SuppressionEnv): boolean {
  if (env.nodeEnv === 'test' || env.vitest) return true;
  if (env.webdriver === true) return true;
  if (env.search) {
    const params = new URLSearchParams(env.search);
    if (SUPPRESS_PARAMS.some((p) => params.has(p))) return true;
  }
  return false;
}

/**
 * A version to show regardless of the gate, recording nothing -- for reading
 * new copy on the real screen before it ships, and for the screenshot in the
 * pull request that writes it.
 *
 *   - Web: `?whatsnew=<version>` on the address, as before.
 *   - Native: the `-whatsnew <version>` launch argument, which iOS files under
 *     NSUserDefaults' argument domain, so React Native's `Settings` reads it:
 *
 *       xcrun simctl launch booted com.eighteenzerodcai.app -whatsnew current
 *
 *     Development builds only. A launch argument cannot reach a store install
 *     anyway, but a release build has no business reading one, and a debug
 *     setting must not be the reason a real player's sheet looks different.
 *
 * `current` stands for the running version, so the command above never needs
 * editing when the version moves.
 */
export interface ForceEnv {
  readonly search?: string;
  readonly launchArg?: unknown;
  readonly dev: boolean;
  readonly current: string | null;
}

export function forcedVersion(env: ForceEnv): string | null {
  let asked: string | null = null;
  if (env.search) asked = new URLSearchParams(env.search).get('whatsnew');
  if (!asked && env.dev && (typeof env.launchArg === 'string' || typeof env.launchArg === 'number')) {
    asked = String(env.launchArg);
  }
  if (!asked) return null;
  return asked === 'current' ? env.current : asked;
}
