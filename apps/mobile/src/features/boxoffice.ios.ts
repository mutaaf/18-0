import { AppState, Settings } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type { TelemetryEvent } from '@/features/telemetry';
import { uuid } from '@/features/uuid';
import * as Q from '@/features/boxoffice-queue';

/**
 * Box Office usage events from the iPhone app, from 1.1.0 (the owner's call,
 * 2026-11-16: "update the native apps too"). The sender around
 * `boxoffice-queue.ts`, which holds the vocabulary and every rule; this file
 * only keeps the queue in AsyncStorage and moves batches.
 *
 * iOS only, by the platform extension: Android gets `boxoffice.ts`, which does
 * nothing, because Google Play's Data safety form has not been changed to say
 * so. The App Store label has to be changed by hand in the same submission as
 * the build carrying this (docs/submission.md, "App Store — App Privacy").
 *
 * Off the game: an event is a push onto an array; the batch goes ten seconds
 * after the last one, or when the app leaves the screen, one request at a time.
 * A failed send keeps its events for next time, and the queue is capped.
 *
 * A development build prints its batches instead of sending them, so our own
 * runs never count as players; the launch argument `-boxoffice send` sends for
 * real (`xcrun simctl launch booted com.eighteenzerodcai.app -boxoffice send`).
 */

const QUEUE_KEY = '17-0:boxoffice:queue';
/** 'off' when the player turned "Share usage stats" off. Anything else is on. */
const PREF_KEY = '17-0:boxoffice:on';
const FLUSH_DELAY_MS = 10_000;
/** Back after this long in the background is a new session, as on the web. */
const SESSION_GAP_MS = 30 * 60_000;

let queue: Q.Queue = Q.emptyQueue();
let on = true;
let ready: Promise<void> | null = null;
let sending = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let backgroundAt: number | null = null;

const release = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '';

function devSend(): boolean {
  try {
    return Settings.get('boxoffice') === 'send';
  } catch {
    return false;
  }
}
const dry = __DEV__ && !devSend();

function save(): void {
  AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue)).catch(() => undefined);
}

function session(): void {
  const started = Q.startSession(queue, Date.now());
  queue = started.queue;
  queue = Q.add(queue, 'session_start', started.props, Date.now(), on, uuid);
  save();
  schedule();
}

/** Loaded once, on the first event of the launch; that is also the launch's session. */
function load(): Promise<void> {
  ready ??= (async () => {
    const [raw, pref] = await Promise.all([
      AsyncStorage.getItem(QUEUE_KEY).catch(() => null),
      AsyncStorage.getItem(PREF_KEY).catch(() => null),
    ]);
    // Merge rather than replace: an event may have arrived while this read.
    const pending = queue.events;
    queue = Q.decode(raw);
    queue = { ...queue, events: [...queue.events, ...pending].slice(-Q.QUEUE_CAP) };
    on = pref !== 'off';
    if (!on) queue = Q.clear(queue);
    session();
    AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (backgroundAt !== null && Date.now() - backgroundAt > SESSION_GAP_MS) session();
        backgroundAt = null;
      } else if (state === 'background') {
        backgroundAt = Date.now();
        void flush();
      }
    });
  })().catch(() => undefined);
  return ready;
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

async function flush(): Promise<void> {
  const batch = Q.next(queue, on);
  const id = queue.installId;
  if (sending || batch.length === 0 || !id) return;
  const body = Q.body(batch, id, release, 'ios');
  if (dry) {
    for (const e of batch) console.log('BOXOFFICE', e.name, JSON.stringify(e.props));
    queue = Q.sent(queue, batch);
    save();
    return;
  }
  sending = true;
  try {
    const res = await fetch(Q.ENDPOINT, {
      method: 'POST',
      // The relay admits an event by its Referer: this game's own Cast List page.
      headers: { 'content-type': 'application/json', Referer: Q.REFERER },
      body,
      credentials: 'omit',
    });
    if (res.ok) {
      queue = Q.sent(queue, batch);
      save();
      if (queue.events.length > 0) schedule();
    }
  } catch {
    // Offline: the events wait for the next flush.
  } finally {
    sending = false;
  }
}

export function forwardToBoxOffice(event: TelemetryEvent): void {
  try {
    const t = Q.translate(event);
    void load().then(() => {
      if (!t || !on) return;
      queue = Q.add(queue, t.name, t.props, event.at, on, uuid);
      save();
      schedule();
    });
  } catch {
    // Analytics must never be able to break a game.
  }
}

/** The Account screen's "Share usage stats" switch. */
export const usageStatsSupported = true;

export async function usageStatsOn(): Promise<boolean> {
  await load();
  return on;
}

/** Off: nothing more is kept or sent, and the queue and the install id are deleted. */
export async function setUsageStats(next: boolean): Promise<boolean> {
  await load();
  on = next;
  if (!next) {
    if (timer) clearTimeout(timer);
    timer = null;
    queue = Q.clear(queue);
    await AsyncStorage.setItem(PREF_KEY, 'off').catch(() => undefined);
  } else {
    await AsyncStorage.removeItem(PREF_KEY).catch(() => undefined);
  }
  save();
  return on;
}
