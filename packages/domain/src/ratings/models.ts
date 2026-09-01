import type { ComponentDef, MetricDef, PositionModel, SeasonStats } from './types.js';
import type { Position } from '../types.js';

const n = (v: number | undefined): number | null =>
  v === undefined || Number.isNaN(v) ? null : v;

/** Safe ratio: null unless the denominator clears a minimum sample. */
const ratio = (num: number | undefined, den: number | undefined, minDen = 1): number | null => {
  if (num === undefined || den === undefined || den < minDen) return null;
  return num / den;
};

const metric = (
  key: string,
  label: string,
  extract: (s: SeasonStats) => number | null,
  higherIsBetter = true,
): MetricDef => ({ key, label, extract, higherIsBetter });

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
    weight: 0.3,
    metrics: [
      metric('epa_per_dropback', 'EPA per dropback', (s) =>
        ratio(s.passing_epa, (s.attempts ?? 0) + (s.sacks_suffered ?? 0), 100)),
      metric('anya', 'Adjusted net yards per attempt', anya),
      metric('ypa', 'Yards per attempt', (s) => ratio(s.passing_yards, s.attempts, 100)),
    ],
  },
  {
    key: 'scoring_production',
    label: 'Touchdown production',
    weight: 0.15,
    metrics: [
      metric('td_rate', 'Touchdown rate', (s) => ratio(s.passing_tds, s.attempts, 100)),
      metric('passing_tds', 'Passing touchdowns', (s) => n(s.passing_tds)),
    ],
  },
  {
    key: 'turnover_avoidance',
    label: 'Turnover avoidance',
    weight: 0.15,
    metrics: [
      metric('turnover_rate', 'Interception + fumble rate', (s) => {
        const giveaways = (s.passing_interceptions ?? 0) + (s.sack_fumbles_lost ?? 0);
        const r = ratio(giveaways, s.attempts, 100);
        return r === null ? null : -r;
      }),
    ],
  },
  {
    key: 'passing_volume',
    label: 'Total passing value',
    weight: 0.1,
    metrics: [
      metric('total_passing_epa', 'Total passing EPA', (s) => n(s.passing_epa)),
      metric('passing_yards', 'Passing yards', (s) => n(s.passing_yards)),
    ],
  },
  {
    key: 'rushing_value',
    label: 'Rushing value',
    weight: 0.05,
    metrics: [
      metric('qb_rush_epa', 'Rushing EPA', (s) => n(s.rushing_epa)),
      metric('qb_rush_yards', 'Rushing yards', (s) => n(s.rushing_yards)),
    ],
  },
  {
    key: 'sack_avoidance',
    label: 'Sack avoidance',
    weight: 0.05,
    metrics: [
      metric('sack_rate', 'Sack rate', (s) => {
        const r = ratio(s.sacks_suffered, (s.attempts ?? 0) + (s.sacks_suffered ?? 0), 100);
        return r === null ? null : -r;
      }),
    ],
  },
  {
    key: 'peak_dominance',
    label: 'Peak dominance vs league',
    weight: 0.1,
    metrics: [],
    percentileOf: 'epa_per_dropback',
  },
  {
    key: 'awards',
    label: 'Awards and honors',
    weight: 0.05,
    metrics: [metric('award_share', 'Award share', (s) => n(s.award_share))],
  },
  {
    key: 'team_success',
    label: 'Team offensive success',
    weight: 0.05,
    metrics: [
      metric('team_off_epa', 'Team offensive EPA per play', (s) => n(s.team_off_epa_per_play)),
      metric('team_points', 'Team points per game', (s) => n(s.team_points_per_game)),
    ],
  },
];

// ---------------------------------------------------------------------------
// Running back
// ---------------------------------------------------------------------------

const touches = (s: SeasonStats) => (s.carries ?? 0) + (s.receptions ?? 0);

const RB_COMPONENTS: readonly ComponentDef[] = [
  {
    key: 'rushing_efficiency',
    label: 'Era-adjusted rushing efficiency',
    weight: 0.25,
    metrics: [
      metric('rush_epa_per_carry', 'Rushing EPA per carry', (s) => ratio(s.rushing_epa, s.carries, 80)),
      metric('ypc', 'Yards per carry', (s) => ratio(s.rushing_yards, s.carries, 80)),
    ],
  },
  {
    key: 'rushing_production',
    label: 'Rushing production',
    weight: 0.2,
    metrics: [metric('rushing_yards', 'Rushing yards', (s) => n(s.rushing_yards))],
  },
  {
    key: 'receiving_value',
    label: 'Receiving value',
    weight: 0.15,
    metrics: [
      metric('rb_rec_epa', 'Receiving EPA', (s) => n(s.receiving_epa)),
      metric('rb_rec_yards', 'Receiving yards', (s) => n(s.receiving_yards)),
    ],
  },
  {
    key: 'scoring',
    label: 'Scoring value',
    weight: 0.1,
    metrics: [
      metric('total_tds', 'Total touchdowns', (s) => n((s.rushing_tds ?? 0) + (s.receiving_tds ?? 0))),
    ],
  },
  {
    key: 'success_rate',
    label: 'First-down conversion',
    weight: 0.1,
    metrics: [
      metric('first_down_rate', 'First downs per touch', (s) =>
        ratio((s.rushing_first_downs ?? 0) + (s.receiving_first_downs ?? 0), touches(s), 80)),
    ],
  },
  {
    key: 'explosive',
    label: 'Explosive plays',
    weight: 0.05,
    metrics: [
      metric('explosive_runs', 'Runs of 20+ yards', (s) => n(s.rushing_20)),
    ],
  },
  {
    key: 'ball_security',
    label: 'Ball security',
    weight: 0.05,
    metrics: [
      metric('fumble_rate', 'Fumbles lost per touch', (s) => {
        const lost = (s.rushing_fumbles_lost ?? 0) + (s.receiving_fumbles_lost ?? 0);
        const r = ratio(lost, touches(s), 80);
        return r === null ? null : -r;
      }),
    ],
  },
  {
    key: 'peak_dominance',
    label: 'Peak dominance',
    weight: 0.05,
    metrics: [],
    percentileOf: 'rushing_yards',
  },
  {
    key: 'awards',
    label: 'Awards and honors',
    weight: 0.05,
    metrics: [metric('award_share', 'Award share', (s) => n(s.award_share))],
  },
];

// ---------------------------------------------------------------------------
// Wide receiver
// ---------------------------------------------------------------------------

const RECEIVER_COMPONENTS = (peakMetric: string): readonly ComponentDef[] => [
  {
    key: 'receiving_production',
    label: 'Era-adjusted receiving production',
    weight: 0.25,
    metrics: [metric('receiving_yards', 'Receiving yards', (s) => n(s.receiving_yards))],
  },
  {
    key: 'receiving_efficiency',
    label: 'Receiving efficiency',
    weight: 0.2,
    metrics: [
      metric('rec_epa_per_target', 'Receiving EPA per target', (s) => ratio(s.receiving_epa, s.targets, 25)),
      metric('yards_per_target', 'Yards per target', (s) => ratio(s.receiving_yards, s.targets, 25)),
      metric('yards_per_reception', 'Yards per reception', (s) => ratio(s.receiving_yards, s.receptions, 15)),
    ],
  },
  {
    key: 'td_production',
    label: 'Touchdown production',
    weight: 0.15,
    metrics: [metric('receiving_tds', 'Receiving touchdowns', (s) => n(s.receiving_tds))],
  },
  {
    key: 'first_downs',
    label: 'First-down creation',
    weight: 0.1,
    metrics: [
      metric('receiving_first_downs', 'Receiving first downs', (s) => n(s.receiving_first_downs)),
    ],
  },
  {
    key: 'offense_share',
    label: 'Share of team offense',
    weight: 0.1,
    metrics: [
      metric('wopr', 'Weighted opportunity rating', (s) => n(s.wopr)),
      metric('target_share', 'Target share', (s) => n(s.target_share)),
      metric('team_yard_share', 'Share of team receiving yards', (s) =>
        ratio(s.receiving_yards, s.team_receiving_yards, 500)),
    ],
  },
  {
    key: 'explosive',
    label: 'Explosive plays',
    weight: 0.05,
    metrics: [metric('explosive_catches', 'Catches of 20+ yards', (s) => n(s.receiving_20))],
  },
  {
    key: 'catch_efficiency',
    label: 'Catch efficiency',
    weight: 0.05,
    metrics: [
      metric('catch_rate', 'Catch rate', (s) => ratio(s.receptions, s.targets, 25)),
    ],
  },
  {
    key: 'peak_dominance',
    label: 'Peak dominance',
    weight: 0.05,
    metrics: [],
    percentileOf: peakMetric,
  },
  {
    key: 'awards',
    label: 'Awards and honors',
    weight: 0.05,
    metrics: [metric('award_share', 'Award share', (s) => n(s.award_share))],
  },
];

// ---------------------------------------------------------------------------
// Tight end — evaluated primarily against other tight ends (PRFAQ §11)
// ---------------------------------------------------------------------------

const TE_COMPONENTS: readonly ComponentDef[] = [
  {
    key: 'receiving_efficiency',
    label: 'Receiving efficiency',
    weight: 0.2,
    metrics: [
      metric('rec_epa_per_target', 'Receiving EPA per target', (s) => ratio(s.receiving_epa, s.targets, 20)),
      metric('yards_per_target', 'Yards per target', (s) => ratio(s.receiving_yards, s.targets, 20)),
    ],
  },
  {
    key: 'receiving_production',
    label: 'Receiving production',
    weight: 0.2,
    metrics: [metric('receiving_yards', 'Receiving yards', (s) => n(s.receiving_yards))],
  },
  {
    key: 'td_production',
    label: 'Touchdown production',
    weight: 0.1,
    metrics: [metric('receiving_tds', 'Receiving touchdowns', (s) => n(s.receiving_tds))],
  },
  {
    key: 'positional_dominance',
    label: 'Dominance among tight ends',
    weight: 0.2,
    metrics: [],
    percentileOf: 'receiving_yards',
  },
  {
    key: 'first_downs',
    label: 'First-down creation',
    weight: 0.1,
    metrics: [metric('receiving_first_downs', 'Receiving first downs', (s) => n(s.receiving_first_downs))],
  },
  {
    key: 'blocking',
    label: 'Blocking contribution',
    weight: 0.1,
    metrics: [metric('block_grade', 'Blocking grade', (s) => n(s.block_grade))],
  },
  {
    key: 'peak_dominance',
    label: 'Peak dominance',
    weight: 0.05,
    metrics: [],
    percentileOf: 'rec_epa_per_target',
  },
  {
    key: 'awards',
    label: 'Awards and honors',
    weight: 0.05,
    metrics: [metric('award_share', 'Award share', (s) => n(s.award_share))],
  },
];

// ---------------------------------------------------------------------------
// Team defense (PRFAQ §11)
// ---------------------------------------------------------------------------

const DEF_COMPONENTS: readonly ComponentDef[] = [
  {
    key: 'points_allowed',
    label: 'Points allowed',
    weight: 0.2,
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
    weight: 0.2,
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
    weight: 0.12,
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
    weight: 0.1,
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
    weight: 0.1,
    metrics: [
      metric('takeaways', 'Takeaways', (s) =>
        n((s.def_interceptions ?? 0) + (s.fumble_recoveries ?? 0))),
    ],
  },
  {
    key: 'pressure',
    label: 'Sack and pressure production',
    weight: 0.08,
    metrics: [metric('def_sacks', 'Sacks', (s) => n(s.def_sacks))],
  },
  {
    key: 'red_zone',
    label: 'Red-zone defense',
    weight: 0.05,
    metrics: [
      metric('red_zone_td_rate', 'Red-zone touchdown rate allowed', (s) => {
        const v = n(s.red_zone_td_rate_allowed);
        return v === null ? null : -v;
      }),
    ],
  },
  {
    key: 'third_down',
    label: 'Third-down defense',
    weight: 0.05,
    metrics: [
      metric('third_down_rate', 'Third-down conversion rate allowed', (s) => {
        const v = n(s.third_down_rate_allowed);
        return v === null ? null : -v;
      }),
    ],
  },
  {
    key: 'era_dominance',
    label: 'Era dominance',
    weight: 0.05,
    metrics: [],
    percentileOf: 'points_allowed_per_game',
  },
  {
    key: 'honors',
    label: 'Historical adjustment',
    weight: 0.05,
    metrics: [metric('award_share', 'Award share', (s) => n(s.award_share))],
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
    components: RECEIVER_COMPONENTS('receiving_yards'),
    qualifies: (s, g) => (s.targets ?? 0) >= proportional(40, g),
  },
  TE: {
    position: 'TE',
    components: TE_COMPONENTS,
    qualifies: (s, g) => (s.targets ?? 0) >= proportional(30, g),
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
