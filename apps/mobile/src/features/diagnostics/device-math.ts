/**
 * The pure halves of `device.ts`: which kind of device this is, which OS a
 * browser is on, and the session id. No React Native, so `device.test.ts` can
 * hold them in node.
 */

export type DeviceClass = 'phone' | 'tablet' | 'tv' | 'web';

/**
 * Phone, tablet, TV or web.
 *
 * The web is its own class rather than a phone or a laptop: its layout follows
 * the window (`web_vitals.viewport` says which), and a browser on an iPad and
 * one on a desktop are the same bundle with the same costs. On Android there is
 * no `isPad`, so a tablet is a screen whose short side is 600 dp or more --
 * Android's own `sw600dp` line, and read from the short side so turning the
 * device over does not change its class.
 */
export function classifyDevice(input: {
  os: string;
  isTV: boolean;
  isPad: boolean;
  shortSide: number;
}): DeviceClass {
  if (input.isTV) return 'tv';
  if (input.os === 'web') return 'web';
  if (input.os === 'ios') return input.isPad ? 'tablet' : 'phone';
  return input.shortSide >= 600 ? 'tablet' : 'phone';
}

/**
 * The OS family and major version a browser is on, from its user agent: `iOS
 * 18`, `Android 15`, `macOS`, `Windows`, `Linux`, `ChromeOS`, or `other`.
 *
 * Coarse on purpose. The full user-agent string is a fingerprinting surface
 * and is never sent; the family and the major version are what a web bug is
 * actually filed against. An iPad on iPadOS 13+ claims to be a Mac, and is
 * reported as `macOS` -- the browser chose to say so.
 */
export function webOsVersion(ua: string): string {
  const ios = /\b(?:iPhone|iPad|iPod)\b.*?\bOS (\d+)/.exec(ua);
  if (ios) return `iOS ${ios[1]}`;
  const android = /\bAndroid (\d+)/.exec(ua);
  if (android) return `Android ${android[1]}`;
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'macOS';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  if (/\bLinux\b/.test(ua)) return 'Linux';
  return 'other';
}

/**
 * A UUIDv7: 48 bits of milliseconds, then randomness.
 *
 * v7 rather than the v4 `features/uuid` makes, because PostHog derives its
 * sessions table from `$session_id` and reads the start time out of the id --
 * a v4 there is a session that began at a random moment in history.
 */
export function uuidv7(now: number, random: (n: number) => Uint8Array): string {
  const bytes = random(16);
  let ms = Math.max(0, Math.floor(now));
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Past this long in the background, coming back is a new session.
 *
 * PostHog's own idle cut, so a session here and a session in its sessions
 * table are the same thing.
 */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

/**
 * One sitting: from a cold start, or a return after half an hour away, to the
 * next of either.
 *
 * Every event carries the id, so "crash-free sessions" is a count of distinct
 * ids rather than a guess from launches -- a launch that is resumed ten times
 * over a day is ten sittings, and the one that crashed is one of them.
 */
export class SessionClock {
  private id: string;
  private hiddenAt: number | null = null;

  constructor(
    private readonly make: (now: number) => string,
    now: number,
  ) {
    this.id = make(now);
  }

  current(): string {
    return this.id;
  }

  /** The app went to the background (or the tab was hidden). */
  hide(now: number): void {
    this.hiddenAt ??= now;
  }

  /** The app is in front again. Returns true when that started a new session. */
  show(now: number): boolean {
    const away = this.hiddenAt === null ? 0 : now - this.hiddenAt;
    this.hiddenAt = null;
    if (away < SESSION_IDLE_MS) return false;
    this.id = this.make(now);
    return true;
  }
}
