import type { ComponentDef, MetricDef, PositionModel, SeasonStats } from './types.js';
import type { Position } from '../types.js';

const n = (v: number | undefined): number | null =>
  v === undefined || Number.isNaN(v) ? null : v;

/** Safe ratio: null unless the denominator clears a minimum sample. */
const ratio = (num: number | undefined, den: number | undefined, minDen = 1): number | null => {
  if (num === undefined || den === undefined || den < minDen) return null;
  return num / den;
};

/**
 * A rate, regressed toward a league-typical prior by sample size.
 *
 *   (observed + prior * k) / (n + k)
 *
 * A raw rate on 25 targets is mostly noise, and scoring it at full weight let
 * low-volume specialists out-rate players who beat them on receptions, yards
 * AND touchdowns — 94 such inversions shipped in the first dataset. Adding `k`
 * phantom league-average attempts pulls a thin sample toward the middle and
 * lets volume win, while a full season's work is barely touched.
 *
 * EPA priors are 0 because EPA is centred on zero by construction.
 */
const shrunk = (
  total: number | undefined,
  attempts: number | undefined,
  prior: number,
  k: number,
  minAttempts = 1,
): number | null => {
  if (total === undefined || attempts === undefined || attempts < minAttempts) return null;
  return (total + prior * k) / (attempts + k);
};

/**
 * Value above expectation: what a player produced, minus what an average
 * player would have produced on the same opportunities.
 *
 * A per-opportunity *rate* is not monotone in production — a receiver with more
 * catches and more yards can have a worse yards-per-target and score lower,
 * which is indefensible when both cards sit in the same list. A *value* stat
 * still rewards efficiency (beat the expectation by more per touch and you
 * gain more) while never punishing someone for producing more.
 */
const aboveExpected = (
  total: number | undefined,
  opportunities: number | undefined,
  perOpportunity: number,
  minOpportunities = 1,
): number | null => {
  if (total === undefined || opportunities === undefined || opportunities < minOpportunities) {
    return null;
  }
  return total - opportunities * perOpportunity;
};

/** Yards from scrimmage — receivers run the ball and backs catch it. */
const scrimmageYards = (s: SeasonStats): number | null => {
  const rushing = s.rushing_yards;
  const receiving = s.receiving_yards;
  if (rushing === undefined && receiving === undefined) return null;
  return (rushing ?? 0) + (receiving ?? 0);
};

/** Every touchdown a skill player scored, however they got there. */
const scrimmageTds = (s: SeasonStats): number | null => {
  const rushing = s.rushing_tds;
  const receiving = s.receiving_tds;
  if (rushing === undefined && receiving === undefined) return null;
  return (rushing ?? 0) + (receiving ?? 0);
};

/** Carries plus catches. */
const touchesOf = (s: SeasonStats): number | null => {
  const carries = s.carries;
  const receptions = s.receptions;
  if (carries === undefined && receptions === undefined) return null;
  return (carries ?? 0) + (receptions ?? 0);
};

const metric = (
  key: string,
  label: string,
  extract: (s: SeasonStats) => number | null,
): MetricDef => ({ key, label, extract });

// ---------------------------------------------------------------------------
// Quarterback (PRFAQ §11)
// ---------------------------------------------------------------------------

/** Adjusted Net Yards per Attempt — the documented pre-EPA fallback. */
const anya = (s: SeasonStats): number | null => {
  const { passing_yards, passing_tds, passing_interceptions, attempts, sacks_suffered, sack_yards_lost } = s;
  if (passing_yards === undefined || attempts === undefined || attempts < 100) return null;
  const denominator = attempts + (sacks_suffered ?? 0);
  if (denominator <= 0) return null;
  return (
    (passing_yards + 20 * (passing_tds ?? 0) - 45 * (passing_interceptions ?? 0) - (sack_yards_lost ?? 0)) /
    denominator
  );
};

const QB_COMPONENTS: readonly ComponentDef[] = [
  {
    key: 'passing_efficiency',
    label: 'Era-adjusted passing efficiency',
    weight: 0.33,
    metrics: [
      metric('epa_per_dropback', 'EPA per dropback', (s) =>
        shrunk(s.passing_epa, (s.attempts ?? 0) + (s.sacks_suffered ?? 0), 0, 120, 100)),
      metric('anya', 'Adjusted net yards per attempt', anya),
      metric('ypa', 'Yards per attempt', (s) => shrunk(s.passing_yards, s.attempts, 7, 120, 100)),
    ],
  },
  {
    key: 'scoring_production',
    label: 'Touchdown production',
    weight: 0.17,
    metrics: [
      metric('td_rate', 'Touchdown rate', (s) => shrunk(s.passing_tds, s.attempts, 0.045, 120, 100)),
      metric('passing_tds', 'Passing touchdowns', (s) => n(s.passing_tds)),
    ],
  },
  {
    key: 'turnover_avoidance',
    label: 'Turnover avoidance',
    weight: 0.17,
    metrics: [
      metric('turnover_rate', 'Interception + fumble rate', (s) => {
        const giveaways =
          (s.passing_interceptions ?? 0) + (s.sack_fumbles_lost ?? 0) + (s.rushing_fumbles_lost ?? 0);
        const r = shrunk(giveaways, s.attempts, 0.03, 120, 100);
        return r === null ? null : -r;
      }),
    ],
  },
  {
    key: 'passing_volume',
    label: 'Total passing value',
    weight: 0.11,
    metrics: [
      metric('total_passing_epa', 'Total passing EPA', (s) => n(s.passing_epa)),
      metric('passing_yards', 'Passing yards', (s) => n(s.passing_yards)),
    ],
  },
  {
    key: 'rushing_value',
    label: 'Rushing value',
    weight: 0.055,
    metrics: [
      metric('qb_rush_epa', 'Rushing EPA', (s) => n(s.rushing_epa)),
      metric('qb_rush_yards', 'Rushing yards', (s) => n(s.rushing_yards)),
    ],
  },
  {
    key: 'sack_avoidance',
    label: 'Sack avoidance',
    weight: 0.055,
    metrics: [
      metric('sack_rate', 'Sack rate', (s) => {
        const r = shrunk(s.sacks_suffered, (s.attempts ?? 0) + (s.sacks_suffered ?? 0), 0.065, 120, 100);
        return r === null ? null : -r;
      }),
    ],
  },
  {
    key: 'peak_dominance',
    label: 'Peak dominance vs league',
    weight: 0.11,
    metrics: [],
    // Season value, not the per-play rate `passing_efficiency` already scores.
    percentileOf: 'total_passing_epa',
  },
];

// ---------------------------------------------------------------------------
// Running back
// ---------------------------------------------------------------------------

const touches = (s: SeasonStats) => (s.carries ?? 0) + (s.receptions ?? 0);

const RB_COMPONENTS: readonly ComponentDef[] = [
  {
    key: 'rushing_efficiency',
    label: 'Value above expectation',
    weight: 0.17,
    metrics: [
      metric('rushing_value', 'Total rushing EPA', (s) => n(s.rushing_epa)),
      metric('rush_yards_above_expected', 'Rushing yards above expectation', (s) =>
        aboveExpected(s.rushing_yards, s.carries, 4.2, 80)),
    ],
  },
  {
    key: 'rushing_production',
    label: 'All-purpose production',
    weight: 0.30,
    metrics: [
      // Scrimmage yards first: a back who catches sixty passes is producing,
      // and rushing yards alone cannot see it.
      metric('scrimmage_yards', 'Yards from scrimmage', scrimmageYards),
      metric('rushing_yards', 'Rushing yards', (s) => n(s.rushing_yards)),
    ],
  },
  {
    // Backs catch passes; a receiving back is doing a different job well and
    // the rushing columns cannot see any of it.
    key: 'receiving_value',
    label: 'Receiving work',
    weight: 0.16,
    metrics: [
      metric('rb_rec_yards', 'Receiving yards', (s) => n(s.receiving_yards)),
      metric('rb_receptions', 'Receptions', (s) => n(s.receptions)),
    ],
  },
  {
    key: 'scoring',
    label: 'Scoring value',
    weight: 0.105,
    metrics: [metric('total_tds', 'Total touchdowns', scrimmageTds)],
  },
  {
    key: 'success_rate',
    label: 'First-down conversion',
    weight: 0.105,
    metrics: [
      metric('first_downs_above_expected', 'First downs above expectation', (s) =>
        aboveExpected(
          (s.rushing_first_downs ?? 0) + (s.receiving_first_downs ?? 0),
          touchesOf(s) ?? undefined,
          0.24,
          80,
        )),
    ],
  },
  {
    key: 'explosive',
    label: 'Explosive plays',
    weight: 0.055,
    metrics: [
      metric('explosive_runs', 'Runs of 20+ yards', (s) => n(s.rushing_20)),
    ],
  },
  {
    key: 'ball_security',
    label: 'Ball security',
    weight: 0.055,
    metrics: [
      metric('fumbles_above_expected', 'Fumbles versus expectation', (s) => {
        const lost = (s.rushing_fumbles_lost ?? 0) + (s.receiving_fumbles_lost ?? 0);
        const v = aboveExpected(lost, touchesOf(s) ?? undefined, 0.008, 80);
        return v === null ? null : -v;
      }),
    ],
  },
  {
    key: 'peak_dominance',
    label: 'Peak dominance',
    weight: 0.05,
    metrics: [],
    // Total scrimmage yards, so this is not a second scoring of the rushing
    // yards `rushing_production` already covers.
    percentileOf: 'scrimmage_yards',
  },
];

// ---------------------------------------------------------------------------
// Wide receiver
// ---------------------------------------------------------------------------

const RECEIVER_COMPONENTS = (peakMetric: string): readonly ComponentDef[] => [
  {
    key: 'receiving_production',
    label: 'All-purpose production',
    weight: 0.30,
    metrics: [
      // Scrimmage yards, because receivers take handoffs — a jet sweep is
      // production and the receiving column cannot see it.
      metric('scrimmage_yards', 'Yards from scrimmage', scrimmageYards),
      metric('receiving_yards', 'Receiving yards', (s) => n(s.receiving_yards)),
    ],
  },
  {
    key: 'receiving_efficiency',
    label: 'Value above expectation',
    weight: 0.17,
    metrics: [
      metric('receiving_value', 'Total receiving EPA', (s) => n(s.receiving_epa)),
      metric('yards_above_expected', 'Yards above expectation', (s) =>
        aboveExpected(s.receiving_yards, s.targets, 8, 25)),
      // Seasons before targets were recorded still have receptions.
      metric('yards_above_expected_per_catch', 'Yards above expectation per catch', (s) =>
        aboveExpected(s.receiving_yards, s.receptions, 12, 15)),
    ],
  },
  {
    key: 'td_production',
    label: 'Touchdown production',
    weight: 0.16,
    metrics: [metric('total_tds', 'Total touchdowns', scrimmageTds)],
  },
  {
    key: 'first_downs',
    label: 'First-down creation',
    weight: 0.105,
    metrics: [
      metric('receiving_first_downs', 'Receiving first downs', (s) => n(s.receiving_first_downs)),
    ],
  },
  {
    key: 'offense_share',
    label: 'Share of team offense',
    weight: 0.105,
    metrics: [
      metric('team_yard_share', 'Share of team receiving yards', (s) =>
        ratio(s.receiving_yards, s.team_receiving_yards, 500)),
      metric('target_share', 'Target share', (s) => n(s.target_share)),
    ],
  },
  {
    key: 'explosive',
    label: 'Explosive plays',
    weight: 0.055,
    metrics: [metric('explosive_catches', 'Catches of 20+ yards', (s) => n(s.receiving_20))],
  },
  {
    key: 'catch_efficiency',
    label: 'Catches above expectation',
    weight: 0.055,
    metrics: [
      metric('catches_above_expected', 'Catches above expectation', (s) =>
        aboveExpected(s.receptions, s.targets, 0.62, 25)),
    ],
  },
  {
    key: 'peak_dominance',
    label: 'Peak dominance',
    weight: 0.05,
    metrics: [
      metric('wopr', 'Weighted opportunity rating', (s) => n(s.wopr)),
      // Older seasons have no target data; share of the team's receiving yards
      // measures the same idea from what does exist.
      metric('team_yard_share', 'Share of team receiving yards', (s) =>
        ratio(s.receiving_yards, s.team_receiving_yards, 500)),
    ],
    // Opportunity share, not the receiving yards `receiving_production` scores.
    percentileOf: peakMetric,
  },
];

// ---------------------------------------------------------------------------
// Tight end — evaluated primarily against other tight ends (PRFAQ §11)
// ---------------------------------------------------------------------------

const TE_COMPONENTS: readonly ComponentDef[] = [
  {
    key: 'receiving_efficiency',
    label: 'Value above expectation',
    weight: 0.185,
    metrics: [
      metric('receiving_value', 'Total receiving EPA', (s) => n(s.receiving_epa)),
      metric('yards_above_expected', 'Yards above expectation', (s) =>
        aboveExpected(s.receiving_yards, s.targets, 7.5, 20)),
      metric('yards_above_expected_per_catch', 'Yards above expectation per catch', (s) =>
        aboveExpected(s.receiving_yards, s.receptions, 11, 12)),
    ],
  },
  {
    key: 'receiving_production',
    label: 'All-purpose production',
    weight: 0.285,
    metrics: [
      metric('scrimmage_yards', 'Yards from scrimmage', scrimmageYards),
      metric('receiving_yards', 'Receiving yards', (s) => n(s.receiving_yards)),
    ],
  },
  {
    key: 'td_production',
    label: 'Touchdown production',
    weight: 0.175,
    metrics: [metric('total_tds', 'Total touchdowns', scrimmageTds)],
  },
  {
    key: 'positional_dominance',
    label: 'Dominance among tight ends',
    weight: 0.235,
    metrics: [],
    // Share of the receiving work, not the raw yardage `receiving_production`
    // already scores — otherwise two components spend 47% of the rating on one
    // number.
    percentileOf: 'team_yard_share',
  },
  {
    key: 'first_downs',
    label: 'First-down creation',
    weight: 0.12,
    metrics: [
      metric('receiving_first_downs', 'Receiving first downs', (s) => n(s.receiving_first_downs)),
      metric('team_yard_share', 'Share of team receiving yards', (s) =>
        ratio(s.receiving_yards, s.team_receiving_yards, 500)),
    ],
  },
];

// ---------------------------------------------------------------------------
// Team defense (PRFAQ §11)
// ---------------------------------------------------------------------------

const DEF_COMPONENTS: readonly ComponentDef[] = [
  {
    key: 'points_allowed',
    label: 'Points allowed',
    weight: 0.235,
    metrics: [
      metric('points_allowed_per_drive', 'Points allowed per drive', (s) => {
        const v = n(s.points_allowed_per_drive);
        return v === null ? null : -v;
      }),
      metric('points_allowed_per_game', 'Points allowed per game', (s) => {
        const r = ratio(s.points_allowed, s.games, 4);
        return r === null ? null : -r;
      }),
    ],
  },
  {
    key: 'def_epa',
    label: 'Defensive EPA per play',
    weight: 0.235,
    metrics: [
      metric('def_epa_per_play', 'EPA allowed per play', (s) => {
        const r = ratio(s.epa_allowed, s.plays_faced, 300);
        return r === null ? null : -r;
      }),
      metric('yards_per_play_allowed', 'Yards allowed per play', (s) => {
        const r = ratio(s.yards_allowed, s.plays_faced, 300);
        return r === null ? null : -r;
      }),
    ],
  },
  {
    key: 'pass_defense',
    label: 'Passing defense',
    weight: 0.14,
    metrics: [
      metric('pass_epa_allowed', 'Passing EPA allowed per dropback', (s) => {
        const r = ratio(s.pass_epa_allowed, s.dropbacks_faced, 200);
        return r === null ? null : -r;
      }),
      metric('ypa_allowed', 'Yards per attempt allowed', (s) => {
        const r = ratio(s.pass_yards_allowed, s.pass_attempts_faced, 200);
        return r === null ? null : -r;
      }),
    ],
  },
  {
    key: 'rush_defense',
    label: 'Rushing defense',
    weight: 0.12,
    metrics: [
      metric('rush_epa_allowed', 'Rushing EPA allowed per carry', (s) => {
        const r = ratio(s.rush_epa_allowed, s.carries_faced, 150);
        return r === null ? null : -r;
      }),
      metric('ypc_allowed', 'Yards per carry allowed', (s) => {
        const r = ratio(s.rush_yards_allowed, s.carries_faced, 150);
        return r === null ? null : -r;
      }),
    ],
  },
  {
    key: 'takeaways',
    label: 'Turnovers forced',
    weight: 0.118,
    metrics: [
      // Per game, so a season with a missing weekly row is not silently
      // penalised against seasons with complete data.
      metric('takeaways_per_game', 'Takeaways per game', (s) =>
        ratio((s.def_interceptions ?? 0) + (s.fumble_recoveries ?? 0), s.games, 4)),
    ],
  },
  {
    key: 'pressure',
    label: 'Sack and pressure production',
    weight: 0.095,
    metrics: [
      metric('sacks_per_game', 'Sacks per game', (s) => ratio(s.def_sacks, s.games, 4)),
    ],
  },
  {
    key: 'era_dominance',
    label: 'Era dominance',
    weight: 0.057,
    metrics: [],
    // Yards per play allowed — a different axis from the points-allowed the
    // `points_allowed` component already scores.
    percentileOf: 'yards_per_play_allowed',
  },
];

// ---------------------------------------------------------------------------
// Qualification floors (PRFAQ §12), proportional for shortened seasons
// ---------------------------------------------------------------------------

const proportional = (base: number, seasonGames: number) => (base * Math.min(seasonGames, 17)) / 17;

export const POSITION_MODELS: Readonly<Record<Position, PositionModel>> = {
  QB: {
    position: 'QB',
    components: QB_COMPONENTS,
    qualifies: (s, g) => (s.games ?? 0) >= proportional(8, g) && (s.attempts ?? 0) >= proportional(180, g),
  },
  RB: {
    position: 'RB',
    components: RB_COMPONENTS,
    qualifies: (s, g) => touches(s) >= proportional(100, g),
  },
  WR: {
    position: 'WR',
    // Peak dominance ranks opportunity share, so it is not a second reading of
    // the receiving yards `receiving_production` already scores.
    components: RECEIVER_COMPONENTS('wopr'),
    // Targets were not recorded before the late 1990s, so seasons without them
    // qualify on receptions instead — otherwise every pre-1999 receiver fails
    // the floor and the older eras have no receivers at all.
    qualifies: (s, g) =>
      s.targets === undefined
        ? (s.receptions ?? 0) >= proportional(25, g)
        : s.targets >= proportional(40, g),
  },
  TE: {
    position: 'TE',
    components: TE_COMPONENTS,
    qualifies: (s, g) =>
      s.targets === undefined
        ? (s.receptions ?? 0) >= proportional(18, g)
        : s.targets >= proportional(30, g),
  },
  DEF: {
    position: 'DEF',
    components: DEF_COMPONENTS,
    qualifies: (s) => (s.games ?? 0) >= 8,
  },
};

/** Every metric key a model can consult, for building season distributions. */
export function metricKeysFor(model: PositionModel): string[] {
  const keys = new Set<string>();
  for (const component of model.components) {
    for (const m of component.metrics) keys.add(m.key);
    if (component.percentileOf) keys.add(component.percentileOf);
  }
  return [...keys];
}
