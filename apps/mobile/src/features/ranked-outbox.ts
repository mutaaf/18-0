import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createLane } from '@/features/net/lane';
import {
  afterAttempt,
  enqueue,
  parseOutbox,
  prune,
  settle,
  type PendingCompletion,
  type RefusalLike,
} from '@/features/ranked-rules';
import { track } from '@/features/telemetry';

/**
 * Ranked completions that have not been confirmed yet, kept on the device and
 * sent again until the server answers. The rules are in `ranked-rules.ts`;
 * this is the storage and the triggers.
 *
 * Written *before* the completion is first sent, so an app killed during the
 * reveal -- or a connection that drops on the last tap -- still has the season
 * waiting to be scored at the next launch.
 */
const KEY = '17-0.ranked-outbox.v1';

/** Every read-modify-write goes through here, so two flushes cannot interleave. */
const lane = createLane();

async function read(): Promise<PendingCompletion[]> {
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  return parseOutbox(raw);
}

async function write(queue: readonly PendingCompletion[]): Promise<void> {
  await (queue.length === 0 ? AsyncStorage.removeItem(KEY) : AsyncStorage.setItem(KEY, JSON.stringify(queue))).catch(
    () => {},
  );
}

export function queueCompletion(sessionId: string, idempotencyKey: string): Promise<void> {
  return lane.run(async () => write(enqueue(await read(), sessionId, idempotencyKey, Date.now())));
}

export function confirmCompletion(sessionId: string): Promise<void> {
  return lane.run(async () => write(settle(await read(), sessionId)));
}

type Complete = (sessionId: string, idempotencyKey: string) => Promise<RefusalLike>;

let flushing = false;

/** Sends each waiting completion once. Never throws. */
export async function flushOutbox(complete: Complete): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const pending = await lane.run(async () => {
      const queue = prune(await read(), Date.now());
      await write(queue);
      return queue;
    });
    for (const entry of pending) {
      let outcome: RefusalLike;
      try {
        outcome = await complete(entry.sessionId, entry.idempotencyKey);
      } catch {
        outcome = { ok: false, kind: 'offline' };
      }
      // The first one that cannot reach the server says the rest will not
      // either; they wait for the next launch or the next return to the app.
      const result = await lane.run(async () => {
        const next = afterAttempt(await read(), entry.sessionId, outcome);
        await write(next.queue);
        return next.result;
      });
      if (result !== 'kept') track('ranked_completion_deferred', { outcome: result, attempts: entry.attempts + 1 });
      if (!outcome.ok && outcome.kind === 'offline') break;
    }
  } catch {
    // Storage or the network failing here costs nothing that the next flush
    // will not try again.
  } finally {
    flushing = false;
  }
}

let started = false;

/** At launch, and every time the app comes back to the foreground. */
export function startOutbox(complete: Complete): void {
  if (started) return;
  started = true;
  void flushOutbox(complete);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void flushOutbox(complete);
  });
}
