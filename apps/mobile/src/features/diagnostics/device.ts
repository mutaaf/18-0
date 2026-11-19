import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { screenShortSide } from '@/theme/layout';
import { runningVersion } from '@/features/whats-new';
import { classifyDevice, SessionClock, uuidv7, webOsVersion, type DeviceClass } from './device-math';

/**
 * Which build, on which OS, on what kind of device, in which sitting.
 *
 * `analytics.ts` puts these on every event it sends, so any tile on any
 * dashboard can be split by build -- the question every regression starts
 * with -- without each event remembering to say. None of it is about the
 * player: a version, a build number, an OS major, a class of device, and a
 * random id that lives for one sitting.
 *
 * Kept free of `features/flags` (and so of `analytics.ts`), because
 * `analytics.ts` imports this: the static half is read once and memoised, and
 * the session id is a field read, so `base()` costs nothing per event.
 */

/**
 * The build: the native build number on a device, the commit on the web.
 *
 * `expo-application` would be the tidy way to read the native one and is not a
 * dependency; `nativeBuildVersion` is deprecated in favour of it but still
 * answers, and a missing build number is a worse report than a deprecated read.
 * The web has no build number, so `app.config.js` stamps the commit Vercel or
 * the Pages workflow built from into `extra.buildId`.
 */
export function buildId(): string {
  if (Platform.OS !== 'web') {
    const native = (Constants as unknown as { nativeBuildVersion?: string | null }).nativeBuildVersion;
    if (native) return String(native);
  }
  const extra = Constants.expoConfig?.extra as { buildId?: unknown } | undefined;
  return typeof extra?.buildId === 'string' && extra.buildId ? extra.buildId : 'dev';
}

function osVersion(): string {
  if (Platform.OS === 'web') {
    return typeof navigator !== 'undefined' && navigator.userAgent ? webOsVersion(navigator.userAgent) : 'other';
  }
  return String(Platform.Version ?? 'unknown');
}

function deviceClass(): DeviceClass {
  return classifyDevice({
    os: Platform.OS,
    isTV: Platform.isTV === true,
    isPad: Platform.OS === 'ios' && (Platform as { isPad?: boolean }).isPad === true,
    shortSide: screenShortSide(),
  });
}

export interface DeviceProps {
  readonly app_version: string;
  readonly build: string;
  readonly os_version: string;
  readonly device_class: DeviceClass;
}

let device: DeviceProps | null = null;

/** Read once: none of these changes while the process lives. */
export function deviceProps(): DeviceProps {
  device ??= {
    app_version: runningVersion() ?? 'unknown',
    build: buildId(),
    os_version: osVersion(),
    device_class: deviceClass(),
  };
  return device;
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const source = (globalThis as { crypto?: Crypto }).crypto;
  // Hermes has no crypto (see features/uuid); a session id needs to be
  // unique, not unguessable.
  if (source?.getRandomValues) source.getRandomValues(bytes);
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

let clock: SessionClock | null = null;

/**
 * This sitting's id. The first read starts the clock and its one AppState
 * listener; on the web, AppState is the page's visibility.
 */
export function sessionId(): string {
  if (!clock) {
    clock = new SessionClock((now) => uuidv7(now, randomBytes), Date.now());
    const sessions = clock;
    try {
      AppState.addEventListener('change', (state) => {
        if (state === 'active') sessions.show(Date.now());
        else sessions.hide(Date.now());
      });
    } catch {
      // No AppState (a test, a strange host): one session for the process.
    }
  }
  return clock.current();
}
