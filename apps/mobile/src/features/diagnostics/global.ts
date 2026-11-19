import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { context, currentRoute } from './context';
import { sessionId } from './device';
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
  /** The sitting it ended, so crash-free sessions can be counted by the build that crashed. */
  session?: string;
  build?: string;
}

interface SessionMark {
  started: number;
  /** True only while the app is `active`. A kill from the app switcher happens after it stops being. */
  foreground: boolean;
  route: string;
  version: string;
  build: string;
  /** The sitting in progress (device.ts). */
  session?: string;
  /** When it last left the foreground; null while in front. */
  hiddenAt?: number | null;
  /** iOS memory warnings this launch. A launch that dies after one is most likely an out-of-memory kill. */
  memoryWarnings?: number;
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
  // First, so the session clock's AppState listener is registered ahead of
  // the one below, and the mark always records the sitting that is current.
  sessionId();

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
      const record: PersistedFatal = {
        ...normalise(error),
        route: currentRoute(),
        at: Date.now(),
        session: sessionId(),
        build: context().build,
      };
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
    mark.hiddenAt = foreground ? null : Date.now();
    mark.session = sessionId();
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
      reportError(error, {
        source: 'previous_launch',
        fatal: true,
        route: fatal.route,
        at: fatal.at,
        extra: {
          ...(fatal.session ? { crashed_session: fatal.session } : {}),
          ...(fatal.build ? { crashed_build: fatal.build } : {}),
        },
      });
    } else if (markRaw) {
      const previous = JSON.parse(markRaw) as SessionMark;
      const warnings = previous.memoryWarnings ?? 0;
      const last = {
        last_route: previous.route,
        last_version: previous.version,
        last_build: previous.build,
        memory_warnings: warnings,
      };
      if (previous.foreground) {
        reportHealth('app_unclean_exit', {
          ...last,
          // Under the names the crash-free-sessions query reads for a fatal
          // too, so one query counts both (docs/observability.md).
          crashed_build: previous.build,
          ...(previous.session ? { crashed_session: previous.session } : {}),
          // A foreground death after iOS warned about memory is, nearly
          // always, the jetsam kill rather than a crash.
          likely_oom: warnings > 0,
        });
      } else {
        // Gone while in the background: the OS reclaiming it, or the player
        // swiping it away -- JS cannot tell which. How long it had been away,
        // and whether memory was short, is what separates the two in bulk: a
        // build whose apps die minutes after leaving is a build using too much.
        const away = typeof previous.hiddenAt === 'number' ? Math.max(0, Date.now() - previous.hiddenAt) : null;
        reportHealth('app_background_exit', {
          ...last,
          ...(away !== null ? { background_s: Math.round(away / 1000) } : {}),
          launch_s: Math.round(Math.max(0, (previous.hiddenAt ?? Date.now()) - previous.started) / 1000),
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
    session: sessionId(),
    hiddenAt: AppState.currentState === 'active' ? null : Date.now(),
    memoryWarnings: 0,
  };
  writeMark();
}

/** Called by `memory.ts` on each warning, so the next launch knows this one was short of memory. */
export function noteMemoryWarning(): void {
  if (!mark) return;
  mark.memoryWarnings = (mark.memoryWarnings ?? 0) + 1;
  writeMark();
}
