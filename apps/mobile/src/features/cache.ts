import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Read-through cache with stale-while-revalidate.
 *
 * The leaderboard and your own profile were refetched from scratch every time
 * you opened the tab, and the screen sat empty until the network answered. They
 * are both things where a few seconds out of date is fine and a blank panel is
 * not — so a cached value is returned immediately and a refresh happens behind
 * it. The screen only ever waits when it has nothing at all to show.
 *
 * Deliberately small: an in-memory map, mirrored to storage so the first paint
 * after a cold start has something too. No invalidation graph, no query keys,
 * no library — there are three cached things in this app.
 */

interface Entry<T> {
  readonly value: T;
  readonly at: number;
}

const memory = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const PREFIX = 'cache:v1:';

/** Values older than this are refreshed in the background when read. */
const DEFAULT_TTL = 60_000;

function persist<T>(key: string, entry: Entry<T>): void {
  AsyncStorage.setItem(PREFIX + key, JSON.stringify(entry)).catch(() => {});
}

async function hydrate<T>(key: string): Promise<Entry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    // A truncated or foreign write is a miss, not a value: `{}` here was
    // handed to a screen as the board.
    if (typeof entry !== 'object' || entry === null || !('value' in entry) || typeof entry.at !== 'number') return null;
    memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

/**
 * Whether a value written at `at` is still fresh at `now`.
 *
 * A value from the future is not. A device whose clock was wrong when it
 * wrote the entry -- set ahead by hand, or before the network time arrived on
 * a cold boot -- otherwise had a negative age, which is less than any TTL, so
 * the board it cached stayed "fresh" until the clock caught up: days of the
 * same leaderboard with no refresh behind it.
 */
export function isFresh(at: number, now: number, ttl: number): boolean {
  const age = now - at;
  return Number.isFinite(age) && age >= 0 && age < ttl;
}

export interface CachedRead<T> {
  readonly value: T | null;
  /** True when `value` came from cache and a refresh is running behind it. */
  readonly stale: boolean;
}

/**
 * Read a value, refreshing it if it is old.
 *
 * `onFresh` fires only when a background refresh produced something different
 * from what was handed back, so a caller can re-render once rather than twice.
 */
export async function cached<T>(
  key: string,
  load: () => Promise<T>,
  options: { ttl?: number; onFresh?: (value: T) => void } = {},
): Promise<CachedRead<T>> {
  const ttl = options.ttl ?? DEFAULT_TTL;
  const entry = (memory.get(key) as Entry<T> | undefined) ?? (await hydrate<T>(key));
  const fresh = entry !== null && entry !== undefined && isFresh(entry.at, Date.now(), ttl);

  if (entry && fresh) return { value: entry.value, stale: false };

  // One refresh at a time per key, however many screens ask.
  const existing = inFlight.get(key) as Promise<T> | undefined;
  const refresh =
    existing ??
    load()
      .then((value) => {
        const next = { value, at: Date.now() };
        memory.set(key, next);
        persist(key, next);
        return value;
      })
      .finally(() => inFlight.delete(key));
  inFlight.set(key, refresh);

  // Something to show already: hand it over and let the refresh land later.
  if (entry) {
    refresh
      .then((value) => {
        if (JSON.stringify(value) !== JSON.stringify(entry.value)) options.onFresh?.(value);
      })
      .catch(() => {});
    return { value: entry.value, stale: true };
  }

  return { value: await refresh, stale: false };
}

/** Drop a key so the next read goes to the network. */
export function invalidate(key: string): void {
  memory.delete(key);
  AsyncStorage.removeItem(PREFIX + key).catch(() => {});
}

/** Everything belonging to a signed-out or deleted account. */
export function invalidateIdentity(): void {
  for (const key of [...memory.keys()]) {
    if (key.startsWith('identity') || key.startsWith('challenges')) invalidate(key);
  }
}
