import { DATASET } from '@18-0/data';

/**
 * Gameplay telemetry (PRFAQ §33).
 *
 * Every spin, pick and result is recorded locally so the loop can actually be
 * inspected — how long a game takes, how often a spin is wasted, which
 * positions stall people, how the record distribution in the wild compares to
 * what the simulation predicted. Properties are non-sensitive gameplay metadata
 * only: no names, no identifiers, ratings as buckets rather than values.
 *
 * Local-only by default. `setSink` forwards to an analytics service if one is
 * ever configured; nothing leaves the device until it is.
 */
export type EventName =
  | 'app_opened'
  | 'play_started'
  | 'game_resumed'
  | 'game_abandoned'
  | 'spin_started'
  | 'spin_completed'
  | 'spin_rigged'
  | 'spin_dead_end'
  | 'player_details_opened'
  | 'slot_targeted'
  | 'player_selected'
  | 'selection_rejected'
  | 'roster_completed'
  | 'result_revealed'
  | 'result_shared'
  | 'build_another_tapped'
  | 'leaderboard_viewed'
  | 'profile_viewed'
  // Ranked play. `score_disagreement` should never fire: both sides run the
  // same deterministic model, so if it ever does, something drifted between
  // the client's copy and the server's.
  | 'ranked_started'
  | 'ranked_downgraded'
  | 'score_disagreement'
  | 'signed_in'
  | 'handle_claimed'
  | 'account_deleted';

export interface TelemetryEvent {
  readonly name: EventName;
  readonly at: number;
  readonly props: Readonly<Record<string, string | number | boolean>>;
}

type Sink = (event: TelemetryEvent) => void;

const RING_SIZE = 500;
const ring: TelemetryEvent[] = [];
let sink: Sink | null = null;

/** Ratings are reported as bands, never as values — §33 asks for buckets. */
export const ratingBucket = (rating: number): string => {
  if (rating >= 98) return '98+';
  if (rating >= 96) return '96-98';
  if (rating >= 93) return '93-96';
  if (rating >= 90) return '90-93';
  if (rating >= 86) return '86-90';
  if (rating >= 80) return '80-86';
  if (rating >= 72) return '72-80';
  return '<72';
};

export function setSink(next: Sink | null): void {
  sink = next;
}

export function track(name: EventName, props: Record<string, string | number | boolean> = {}): void {
  const event: TelemetryEvent = {
    name,
    at: Date.now(),
    props: { ...props, dataset: DATASET.version, model: DATASET.ratingModelVersion },
  };
  ring.push(event);
  if (ring.length > RING_SIZE) ring.shift();
  try {
    sink?.(event);
  } catch {
    // Telemetry must never be able to break gameplay.
  }
}

export function recentEvents(limit = RING_SIZE): TelemetryEvent[] {
  return ring.slice(-limit);
}

export interface SessionSummary {
  readonly events: number;
  readonly spins: number;
  readonly picks: number;
  readonly rejected: number;
  readonly deadEnds: number;
  readonly gamesFinished: number;
  readonly riggedSpins: number;
  /** Median seconds between a spin landing and the pick that followed it. */
  readonly medianPickSeconds: number | null;
}

/** A read-out of the loop, for the in-app diagnostics screen. */
export function summarise(): SessionSummary {
  const gaps: number[] = [];
  let lastSpin: number | null = null;
  for (const e of ring) {
    if (e.name === 'spin_completed') lastSpin = e.at;
    if (e.name === 'player_selected' && lastSpin !== null) {
      gaps.push((e.at - lastSpin) / 1000);
      lastSpin = null;
    }
  }
  gaps.sort((a, b) => a - b);
  const count = (name: EventName) => ring.filter((e) => e.name === name).length;

  return {
    events: ring.length,
    spins: count('spin_completed'),
    picks: count('player_selected'),
    rejected: count('selection_rejected'),
    deadEnds: count('spin_dead_end'),
    gamesFinished: count('result_revealed'),
    riggedSpins: count('spin_rigged'),
    medianPickSeconds: gaps.length ? Number(gaps[Math.floor(gaps.length / 2)]!.toFixed(1)) : null,
  };
}
