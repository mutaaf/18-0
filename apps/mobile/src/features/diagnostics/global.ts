import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { context, currentRoute } from './context';
import { normalise } from './errors';
import { reportError, reportHealth } from './report';

/**
 * Uncaught errors on iOS and Android.
 *
 * Three things a release build otherwise loses without trace:
 *
 * **A JS fatal.** React Native's default handler turns it into a native crash
 * at once, so a report queued for the next analytics flush dies with the
 * process. It is written to storage instead, the default handler runs once the
 * write lands (or after half a second, whichever is first), and the report is
 * sent on the next launch with the time and route it actually happened at.
 *
 * **An unhandled promise rejection.** React Native tracks these only in
 * development, for LogBox; in a release build a rejected `fetch` nobody awaited
 * vanishes. Hermes' own tracker is switched on here for release builds only, so
 * development keeps its yellow boxes.
 *
 * **A native crash, an out-of-memory kill or a watchdog kill.** No JS runs, so
 * none of it can be caught from here -- that needs a native SDK this project
 * deliberately does not have (see docs/observability.md). What JS *can* see is
 * the aftermath: a launch that finds the previous one never left the
 * foreground and never reported a fatal. That is `app_unclean_exit`, a count
 * and a route rather than a stack, and the stacks are in Xcode Organizer and
 * Play Console's Android vitals.
 */

const FATAL_KEY = '18-0:diagnostics:fatal';
const SESSION_KEY = '18-0:diagnostics:session';

interface PersistedFatal {
  type: string;
  message: string;
  stack: string;
  route: string;
  at: number;
}

interface SessionMark {
  started: number;
  /** True only while the app is `active`. A kill from the app switcher happens after it stops being. */
  foreground: boolean;
  route: string;
  version: string;
  build: string;
}

let installed = false;
let mark: SessionMark | null = null;

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function writeMark(): void {
  if (!mark) return;
  void AsyncStorage.setItem(SESSION_KEY, JSON.stringify(mark)).catch(() => undefined);
}

/** Keeps the session mark's route current, so an unclean exit says where it happened. */
export function noteRoute(route: string): void {
  if (!mark || mark.route === route) return;
  mark.route = route;
  writeMark();
}

export function installGlobalHandlers(): void {
  if (installed) return;
  installed = true;

  const utils = (globalThis as { ErrorUtils?: {
    getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
    setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
  } }).ErrorUtils;

  if (utils) {
    const previous = utils.getGlobalHandler();
    utils.setGlobalHandler((error, isFatal) => {
      if (!isFatal || __DEV__) {
        reportError(error, { source: 'global', fatal: Boolean(isFatal) });
        previous(error, isFatal);
        return;
      }
      const record: PersistedFatal = { ...normalise(error), route: currentRoute(), at: Date.now() };
      void Promise.race([
        AsyncStorage.setItem(FATAL_KEY, JSON.stringify(record)).catch(() => undefined),
        later(500),
      ]).then(() => previous(error, isFatal));
    });
  }

  if (!__DEV__) {
    const hermes = (globalThis as { HermesInternal?: {
      enablePromiseRejectionTracker?: (options: {
        allRejections: boolean;
        onUnhandled: (id: number, rejection: unknown) => void;
        onHandled: (id: number) => void;
      }) => void;
    } }).HermesInternal;
    hermes?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, rejection) => {
        reportError(rejection, { source: 'unhandled_rejection' });
      },
      onHandled: () => undefined,
    });
  }

  void lookBack();

  AppState.addEventListener('change', (state) => {
    if (!mark) return;
    const foreground = state === 'active';
    if (mark.foreground === foreground) return;
    mark.foreground = foreground;
    writeMark();
  });
}

/** What the previous launch left behind: a fatal to send, or a mark that says it never got to. */
async function lookBack(): Promise<void> {
  try {
    const [fatalRaw, markRaw] = await Promise.all([AsyncStorage.getItem(FATAL_KEY), AsyncStorage.getItem(SESSION_KEY)]);
    await AsyncStorage.removeItem(FATAL_KEY).catch(() => undefined);

    if (fatalRaw) {
      const fatal = JSON.parse(fatalRaw) as PersistedFatal;
      const error = Object.assign(new Error(fatal.message), { name: fatal.type, stack: fatal.stack });
      reportError(error, { source: 'previous_launch', fatal: true, route: fatal.route, at: fatal.at });
    } else if (markRaw) {
      const previous = JSON.parse(markRaw) as SessionMark;
      if (previous.foreground) {
        reportHealth('app_unclean_exit', {
          last_route: previous.route,
          last_version: previous.version,
          last_build: previous.build,
        });
      }
    }
  } catch {
    // A corrupt mark is not worth a report of its own.
  }

  const now = context();
  mark = {
    started: Date.now(),
    foreground: AppState.currentState === 'active',
    route: currentRoute(),
    version: now.app_version!,
    build: now.build!,
  };
  writeMark();
}
