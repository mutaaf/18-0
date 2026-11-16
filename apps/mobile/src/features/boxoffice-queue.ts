import { ENDINGS_18_GAME } from '@17-0/domain';
import type { TelemetryEvent } from '@/features/telemetry';

/**
 * Box Office from the iPhone app: the pure half (vocabulary, the check every
 * event passes, the on-disk queue and the bytes of a batch). `boxoffice.ts`
 * is the storage and the network around it; nothing in here imports React
 * Native, so the rules run under vitest.
 *
 * Copied from Cold Gas's iPhone app (mutaaf/cold-gas, ColdGasClient/
 * Insights.swift), which is the reference for every native app (box-office
 * AGENTS.md rule 6): PostHog's `/batch/` shape POSTed to the first-party relay
 * on mutaafaziz.com, with `Referer:` this game's own Cast List page, because
 * the relay admits an event only when its Referer is a general-audience app.
 * No SDK, no autocapture, no replays, no advertising id. The one id is a random
 * install id made on this device; the Settings switch deletes it with the queue.
 *
 * Props are numbers, flags and enums only. A prop outside its range or its list
 * is dropped, never sent, and an unknown event name is dropped whole -- so a
 * handle, a card id or free text cannot leave through here even if a caller
 * tries.
 */

export const ENDPOINT = 'https://mutaafaziz.com/boxoffice/e/batch/';
/** Cast List's page for `17-0`. The relay matches host + path. */
export const REFERER = 'https://18-0.co/';
/** PostHog's public ingest key, the one Box Office serves every page: write-only, made for clients. */
export const TOKEN = 'phc_pj2w4pWnPNUNK5hZK5TX35tNRFa9skJQrGmZNbHVHr9m';
export const QUEUE_CAP = 300;
export const BATCH_MAX = 50;

type Rule =
  | { kind: 'number'; min: number; max: number }
  | { kind: 'oneOf'; values: readonly string[] }
  | { kind: 'flag' };

const num = (min: number, max: number): Rule => ({ kind: 'number', min, max });
const oneOf = (values: readonly string[]): Rule => ({ kind: 'oneOf', values });
const flag: Rule = { kind: 'flag' };

export const MODES = ['rookie', 'scout', 'player_iq', 'gameday'] as const;
/** `ratingBucket()`'s bands, the only form a rating is ever reported in. */
export const RATING_BANDS = ['98+', '96-98', '93-96', '90-93', '86-90', '80-86', '72-80', '<72'] as const;
/** Every ending key, 17- and 18-game (the 17-game table is a subset). */
export const ENDING_KEYS = ENDINGS_18_GAME.map((e) => e.key);

/** Every event the app may send and every prop each may carry. The web's names, plus session_start. */
export const EVENTS: Readonly<Record<string, Readonly<Record<string, Rule>>>> = {
  session_start: { returning: flag, days_since_last: num(0, 3650) },
  game_start: { mode: oneOf(MODES), ranked: flag },
  game_over: {
    wins: num(0, 18),
    losses: num(0, 18),
    mode: oneOf(MODES),
    ending: oneOf(ENDING_KEYS),
    rating_band: oneOf(RATING_BANDS),
  },
};

export type Value = string | number | boolean;
export type Props = Record<string, Value>;

/** The event with only its known props, each inside its rule; null for a name not in the vocabulary. */
export function clean(name: string, props: Readonly<Record<string, unknown>>): Props | null {
  const spec = EVENTS[name];
  if (!spec) return null;
  const out: Props = {};
  for (const [key, value] of Object.entries(props)) {
    const rule = spec[key];
    if (!rule) continue;
    if (rule.kind === 'number' && typeof value === 'number' && Number.isFinite(value) && value >= rule.min && value <= rule.max) {
      out[key] = value;
    } else if (rule.kind === 'oneOf' && typeof value === 'string' && rule.values.includes(value)) {
      out[key] = value;
    } else if (rule.kind === 'flag' && typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

/** The telemetry stream, in the portfolio's words -- the same translation as `boxoffice.web.ts`. */
export function translate(
  event: Pick<TelemetryEvent, 'name' | 'props'>,
): { name: string; props: Record<string, unknown> } | null {
  const p = event.props;
  if (event.name === 'play_started') return { name: 'game_start', props: { mode: p.mode, ranked: p.ranked } };
  if (event.name === 'roster_completed') {
    // `record` is "wins-losses"; the dashboards want the numbers.
    const [wins, losses] = String(p.record ?? '').split('-').map(Number);
    return {
      name: 'game_over',
      props: { wins, losses, mode: p.mode, ending: p.ending, rating_band: p.rating },
    };
  }
  return null;
}

export interface QueuedEvent {
  name: string;
  props: Props;
  /** Milliseconds since 1970, the device clock. */
  at: number;
}

/** What is kept on the device. `sessions` and `lastDay` are local counters, sent only as session_start's numbers. */
export interface Queue {
  events: QueuedEvent[];
  installId: string | null;
  sessions: number;
  lastDay: number | null;
}

export const emptyQueue = (): Queue => ({ events: [], installId: null, sessions: 0, lastDay: null });

/** Whatever was on disk, or a fresh queue. Never throws, and re-applies the cap. */
export function decode(raw: string | null): Queue {
  try {
    const q = raw ? (JSON.parse(raw) as Partial<Queue>) : null;
    if (!q || typeof q !== 'object') return emptyQueue();
    const events = Array.isArray(q.events)
      ? q.events.filter((e): e is QueuedEvent => !!e && typeof e.name === 'string' && typeof e.at === 'number' && !!e.props)
      : [];
    return {
      events: events.slice(-QUEUE_CAP),
      installId: typeof q.installId === 'string' ? q.installId : null,
      sessions: typeof q.sessions === 'number' ? q.sessions : 0,
      lastDay: typeof q.lastDay === 'number' ? q.lastDay : null,
    };
  } catch {
    return emptyQueue();
  }
}

/**
 * Add an event, checked against the vocabulary. Off: nothing is kept. The first
 * event kept makes the install id. The oldest go first past the cap.
 */
export function add(q: Queue, name: string, props: Readonly<Record<string, unknown>>, at: number, on: boolean, newId: () => string): Queue {
  if (!on) return q;
  const p = clean(name, props);
  if (!p) return q;
  const events = [...q.events, { name, props: p, at }].slice(-QUEUE_CAP);
  return { ...q, events, installId: q.installId ?? newId() };
}

/** The next batch: the oldest events, at most BATCH_MAX. Empty when off or with nothing to send. */
export function next(q: Queue, on: boolean): QueuedEvent[] {
  if (!on || !q.installId) return [];
  return q.events.slice(0, BATCH_MAX);
}

/** The relay took these: drop them, by identity, so events added while the batch was in flight stay. */
export function sent(q: Queue, batch: readonly QueuedEvent[]): Queue {
  const gone = new Set(batch);
  return { ...q, events: q.events.filter((e) => !gone.has(e)) };
}

/** The switch went off: the events and the id are gone (a new id is made if it is turned on again). */
export function clear(q: Queue): Queue {
  return { ...q, events: [], installId: null };
}

/** Days since 1970, UTC. */
export const day = (ms: number) => Math.floor(ms / 86_400_000);

/** A new session: session_start's props, and the counters moved on. */
export function startSession(q: Queue, at: number): { queue: Queue; props: Props } {
  const today = day(at);
  const since = q.lastDay === null ? 0 : Math.max(0, today - q.lastDay);
  return {
    queue: { ...q, sessions: q.sessions + 1, lastDay: today },
    props: { returning: q.sessions > 0, days_since_last: Math.min(3650, since) },
  };
}

/** The props every event carries, as Box Office's loader registers them on a page. */
export function base(release: string, platform: string): Props {
  return { app: '17-0', surface: 'app', platform, audience: 'general', site: '18-0.co', release };
}

/** The body of one POST, PostHog's `/batch/` shape. `$geoip_disable`: no location is derived. */
export function body(batch: readonly QueuedEvent[], installId: string, release: string, platform: string): string {
  const shared = base(release, platform);
  return JSON.stringify({
    api_key: TOKEN,
    batch: batch.map((e) => ({
      event: e.name,
      timestamp: new Date(e.at).toISOString(),
      properties: { ...shared, ...e.props, distinct_id: installId, $lib: '17-0-native', $geoip_disable: true },
    })),
  });
}
