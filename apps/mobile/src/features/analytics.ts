import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uuid } from '@/features/uuid';
import { setSink, type TelemetryEvent } from '@/features/telemetry';

/**
 * Product analytics, when they are configured.
 *
 * The console at /admin answers "what is the server doing right now" -- who is
 * playing, what got refused, how slow it was. It cannot answer "do people who
 * try Scout come back", because that is a question about people over weeks and
 * the answer lives in funnels, cohorts and retention curves rather than in a
 * table of rows. So this is a second sink on the same events.
 *
 * PostHog rather than Datadog or New Relic: those two are infrastructure APM,
 * built around hosts and traces, and neither profiles a *player*. PostHog's
 * free tier carries a million events a month with person profiles, funnels,
 * retention and cohorts, which is exactly the shape of the question.
 *
 * Over the HTTP capture API rather than the SDK, deliberately. The React
 * Native SDK is a native dependency -- it would mean a rebuild of the iOS app
 * to change an analytics vendor, and a second code path for web. This is one
 * fetch, identical on every platform, and it sends only the fields written
 * here.
 *
 * Nothing leaves the device unless EXPO_PUBLIC_POSTHOG_KEY is set. With no key
 * this module installs no sink at all.
 */

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const HOST = (process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com').replace(/\/+$/, '');

/** Where the anonymous id lives, so one device is one person across launches. */
const DEVICE_ID_KEY = '18-0:analytics:device';

const BATCH_LIMIT = 20;
const FLUSH_MS = 15_000;

interface Captured {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

let queue: Captured[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let distinctId: string | null = null;
/** Set once the player signs in, so their events stop being anonymous. */
let identified: string | null = null;

export const analyticsConfigured = Boolean(KEY);

/**
 * A stable id for this device, generated locally.
 *
 * Not the Supabase user id: most players are anonymous, and an id that changed
 * every launch would make every returning player look like a new one and every
 * retention number a lie.
 */
async function deviceId(): Promise<string> {
  if (distinctId) return distinctId;
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY).catch(() => null);
  if (stored) {
    distinctId = stored;
    return stored;
  }
  const fresh = uuid();
  await AsyncStorage.setItem(DEVICE_ID_KEY, fresh).catch(() => undefined);
  distinctId = fresh;
  return fresh;
}

async function send(path: string, body: unknown): Promise<void> {
  if (!KEY) return;
  try {
    await fetch(`${HOST}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // A failed analytics call is not an event worth reporting to the user,
      // and must never hold up anything they are doing.
      keepalive: true,
    });
  } catch {
    // Dropped on purpose. Analytics that can break the game is worse than no
    // analytics, and the local ring buffer still has everything.
  }
}

async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  await send('/batch/', { api_key: KEY, batch });
}

/** The last profile actually sent, so a re-render is not a network call. */
let lastProfile = '';

/**
 * Who this is, once they have an account.
 *
 * `$set` writes person properties, which is what turns a stream of events into
 * a profile you can filter and build a cohort from. Everything here is either
 * chosen by the player and already public (the handle appears on the
 * leaderboard) or a coarse bucket. No email, no auth identity, no roster --
 * the account identifier is a UUID that means nothing outside this project.
 */
export async function identifyPlayer(person: {
  userId: string;
  handle: string | null;
  named: boolean;
  seasons?: number;
  bestRatingBucket?: string;
  favouriteMode?: string;
}): Promise<void> {
  if (!KEY) return;
  const fingerprint = JSON.stringify(person);
  if (fingerprint === lastProfile) return;
  lastProfile = fingerprint;
  const previous = await deviceId();

  // Ties the anonymous history to the account, so the funnel that starts
  // before sign-in does not break at the moment they sign in.
  if (identified !== person.userId) {
    await send('/capture/', {
      api_key: KEY,
      event: '$create_alias',
      distinct_id: person.userId,
      properties: { alias: previous, ...base() },
    });
    identified = person.userId;
    distinctId = person.userId;
  }

  await send('/capture/', {
    api_key: KEY,
    event: '$identify',
    distinct_id: person.userId,
    properties: {
      ...base(),
      $set: {
        handle: person.handle ?? undefined,
        signed_in: person.named,
        seasons: person.seasons,
        best_rating_band: person.bestRatingBucket,
        favourite_mode: person.favouriteMode,
        platform: Platform.OS,
      },
    },
  });
}

/**
 * Which variants this player is in, if any.
 *
 * Installed by the flag runtime rather than imported from it, for the reason
 * `setSink` exists: this module owns the identity and the wire, and knowing
 * what a flag *means* is somebody else's job. It also keeps the dependency
 * pointing one way -- flags read analytics, never the reverse.
 */
let flagProperties: (() => Record<string, string | number | boolean>) | null = null;

export function setFlagProperties(
  provider: (() => Record<string, string | number | boolean>) | null,
): void {
  flagProperties = provider;
}

/**
 * Properties every event carries, so any of them can be grouped on.
 *
 * `$feature/<key>` is PostHog's own convention, and putting it here is what
 * makes every funnel in the product -- spins, picks, completions, retention --
 * breakable down by experiment variant without instrumenting anything twice.
 */
const base = (): Record<string, unknown> => ({
  platform: Platform.OS,
  app: '18-0',
  ...(flagProperties?.() ?? {}),
});

/**
 * Ask PostHog which flags this player has.
 *
 * `/decide` is the same free-tier product as the events above -- flags and
 * experiments are included, so controlling a feature costs nothing new and
 * needs no second vendor. One POST per launch, over plain fetch for the same
 * reason capture is: the React Native SDK is a native dependency, and changing
 * an analytics vendor should not mean rebuilding the iOS app.
 *
 * Returns null on anything at all going wrong -- no key, no network, a shape
 * that is not what was expected. Null means "nobody said otherwise", and the
 * caller then ships the registry's fallbacks, which is what the app was built
 * and tested with.
 */
export async function fetchRemoteFlags(): Promise<Record<string, unknown> | null> {
  if (!KEY) return null;
  try {
    const res = await fetch(`${HOST}/decide/?v=3`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        distinct_id: identified ?? (await deviceId()),
        // Assignment is PostHog's, and it is sticky on this id: two launches
        // of the same install land in the same variant, which is the whole
        // requirement of an experiment.
        person_properties: { platform: Platform.OS, app: '18-0' },
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      featureFlags?: Record<string, unknown>;
      flags?: Record<string, { enabled?: boolean; variant?: string | null }>;
    };
    if (body.featureFlags && typeof body.featureFlags === 'object') return body.featureFlags;
    // The newer response shape, flattened to the same map. Handled because a
    // project can be moved onto it without the app being rebuilt.
    if (body.flags && typeof body.flags === 'object') {
      return Object.fromEntries(
        Object.entries(body.flags).map(([key, state]) => [key, state?.variant ?? state?.enabled ?? false]),
      );
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Installs the sink. Safe to call unconditionally: with no key it does nothing
 * and no network call is ever made.
 */
export function startAnalytics(): void {
  if (!KEY) return;

  setSink((event: TelemetryEvent) => {
    void (async () => {
      queue.push({
        event: event.name,
        distinct_id: identified ?? (await deviceId()),
        properties: { ...event.props, ...base() },
        timestamp: new Date(event.at).toISOString(),
      });
      if (queue.length >= BATCH_LIMIT) void flush();
    })();
  });

  timer ??= setInterval(() => void flush(), FLUSH_MS);

  // The web can close mid-session with a batch still queued. `keepalive` on the
  // fetch is what lets that last one actually leave.
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush();
    });
  }
}

/** For a sign-out: the next events belong to nobody in particular again. */
export async function resetAnalytics(): Promise<void> {
  identified = null;
  lastProfile = '';
  distinctId = null;
  await AsyncStorage.removeItem(DEVICE_ID_KEY).catch(() => undefined);
}
