import { DATASET } from '@17-0/data';
import { forwardToBoxOffice } from '@/features/boxoffice';
import { cleanProps } from '@/features/diagnostics/guard';

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
  | 'tv_jank'
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
  // The Share button pressed, then (as result_shared) how it went: the gap
  // between the two is everyone who opened the sheet and closed it.
  | 'share_tapped'
  | 'result_shared'
  // The lens suggestion (features/lens.ts): shown, taken, or put off.
  | 'lens_suggested'
  | 'lens_suggestion_taken'
  | 'lens_suggestion_dismissed'
  // A player marking one of their seven as rated too low or too high (or
  // taking that back). Evidence for the next refit; never read by a score.
  | 'rating_feedback_given'
  // Gut Check (app/rate.tsx): a round of swipes opened, and one played out.
  | 'gut_check_started'
  | 'gut_check_finished'
  | 'build_another_tapped'
  | 'leaderboard_viewed'
  | 'leaderboard_roster_opened'
  | 'profile_viewed'
  // Ranked play. `score_disagreement` should never fire: both sides run the
  // same deterministic model, so if it ever does, something drifted between
  // the client's copy and the server's.
  | 'ranked_started'
  | 'app_link_opened'
  | 'reminders_prompted'
  | 'reminder_scheduled'
  // The switch on the account screen, as opposed to the system prompt. A
  // player turning these off in the app rather than in Settings is the signal
  // that the reminder itself was unwelcome, not the permission.
  | 'reminders_toggled'
  | 'challenge_created'
  | 'challenge_accepted'
  | 'ranked_downgraded'
  | 'ranked_completion_deferred'
  | 'score_disagreement'
  // Gameday. `version_mismatch` is the server telling us the two sides are on
  // different models -- the cause `score_disagreement` could previously only
  // report the symptom of.
  | 'gameday_started'
  | 'version_mismatch'
  | 'signed_in'
  | 'handle_claimed'
  | 'account_deleted'
  | 'theme_changed'
  /** Respins (docs/respins.md): the sheet, a purchase, a spend. No prices, no ids. */
  | 'respin_sheet_opened'
  | 'respin_purchased'
  | 'respin_spent'
  /**
   * Feature flags. The `$`-prefixed name is not a typo and not ours: PostHog
   * computes an experiment's exposure from an event called exactly this, with
   * exactly these two properties, so a variant that is resolved but never
   * reported is a variant with no denominator. See `features/flags`.
   */
  | '$feature_flag_called'
  /**
   * Diagnostics (`features/diagnostics`, docs/observability.md). Gated by the
   * `diagnostics` flag and by a browser's GPC/DNT signal, so none of these is
   * sent where either says no.
   *
   * `$exception` is PostHog's error-tracking event, spelled their way for the
   * reason `$feature_flag_called` is: their issue grouping only reads an event
   * of exactly this name. The props here are flat; `analytics.ts` rebuilds
   * `$exception_list` on the way out.
   */
  | '$exception'
  /** Cold start to the first screen a player can use, once per launch. */
  | 'app_started'
  /** The last launch ended with the app in front and no JS error: a native crash, OOM or watchdog kill. */
  | 'app_unclean_exit'
  /** LCP, CLS and INP on the web build, once per page. */
  | 'web_vitals'
  /** Every Edge Function call and ranked insert: how long, and how it ended. */
  | 'server_call'
  /** A ranked season fell back to unranked, wherever in the game it happened. */
  | 'season_downgraded'
  /** A route change to the new screen's first frame and to the JS thread going idle, once per navigation. */
  | 'screen_ready'
  /** Frame hitches and JS delay in short windows after touches and navigations, one summary per screen. Phones, tablets and the web; the TV has `tv_jank`. */
  | 'ui_jank'
  /** iOS said memory is low. Rate-limited; the count rides on the next one. */
  | 'memory_warning'
  /** The previous launch ended while in the background: usually the OS reclaiming it, sometimes the player swiping it away. */
  | 'app_background_exit';

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

/**
 * Events tracked before any sink was installed, handed to the first one.
 *
 * The sink arrives in the root layout's effect, and diagnostics start before
 * the first render -- so a crash reported from the previous launch, or the
 * start-up time, was being tracked into a ring with nobody listening, and
 * reached the console and never PostHog. Capped, because with no PostHog key
 * configured no sink ever arrives.
 */
const HELD_LIMIT = 100;
let held: TelemetryEvent[] = [];

export function setSink(next: Sink | null): void {
  sink = next;
  if (!next || held.length === 0) return;
  const early = held;
  held = [];
  for (const event of early) {
    try {
      next(event);
    } catch {
      // Same rule as track(): telemetry must never be able to break gameplay.
    }
  }
}

/**
 * `at` is for an event reported after the fact -- a crash from the previous
 * launch is sent on this one, and filing it under now would put it in the
 * wrong release's error rate.
 */
export function track(
  name: EventName,
  props: Record<string, string | number | boolean> = {},
  at: number = Date.now(),
): void {
  // Flat primitives and no person-shaped keys (diagnostics/guard.ts): what a
  // cast or a spread got past the type is dropped here, before the ring, Box
  // Office or PostHog can see it.
  const clean = cleanProps(props);
  if (clean.dropped.length && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(`[telemetry] ${name}: dropped ${clean.dropped.join(', ')} (not a flat primitive, or looks like PII)`);
  }
  const event: TelemetryEvent = {
    name,
    at,
    props: { ...clean.props, dataset: DATASET.version, model: DATASET.ratingModelVersion },
  };
  ring.push(event);
  if (ring.length > RING_SIZE) ring.shift();
  forwardToBoxOffice(event);
  if (!sink) {
    if (held.length < HELD_LIMIT) held.push(event);
    return;
  }
  try {
    sink(event);
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
    // `roster_completed`, not `result_revealed`: the latter is declared but
    // nothing sends it, so the console's "Games finished" always read zero.
    gamesFinished: count('roster_completed'),
    riggedSpins: count('spin_rigged'),
    medianPickSeconds: gaps.length ? Number(gaps[Math.floor(gaps.length / 2)]!.toFixed(1)) : null,
  };
}
