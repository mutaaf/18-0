/**
 * Builds the bundled historical dataset from the nflverse CSV drops.
 *
 *   pnpm --filter @18-0/data build:dataset
 *
 * NFL history is immutable, so this runs once and its output ships with the
 * app. Raw CSVs live in `data/raw` and are not committed; re-fetch them with
 * `data/raw/fetch.sh`.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POSITION_MODELS,
  applyPlayerCalibration,
  fitPlayerCalibration,
  buildSeasonContext,
  extractMetrics,
  percentileRank,
  rateSeason,
  type Archetype,
  type EraKey,
  type Position,
  type PlayerCalibration,
  type SeasonStats,
} from '@18-0/domain';
import { ERA_TABLE, eraForYear } from './eras.js';
import type { Dataset, DatasetCard, DatasetComponent, StatLine } from './schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = resolve(HERE, '../../../data/raw');
const OUT = resolve(HERE, '../generated/dataset.json');

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function parseCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf8');
  const rows: Record<string, string>[] = [];
  let header: string[] | null = null;
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => { record.push(field); field = ''; };
  const pushRecord = () => {
    pushField();
    if (record.length === 1 && record[0] === '') { record = []; return; }
    if (!header) header = record;
    else rows.push(Object.fromEntries(header.map((h, i) => [h, record[i] ?? ''])));
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') pushField();
    else if (ch === '\n') pushRecord();
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || record.length > 0) pushRecord();
  return rows;
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '' || v === 'NA') return undefined;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : undefined;
};

// ---------------------------------------------------------------------------
// Franchises and eras
// ---------------------------------------------------------------------------

/** nflverse already collapses relocations onto the current franchise code. */
const TEAM_TO_FRANCHISE: Readonly<Record<string, string>> = {
  ARI: 'ari', ATL: 'atl', BAL: 'bal', BUF: 'buf', CAR: 'car', CHI: 'chi', CIN: 'cin',
  CLE: 'cle', DAL: 'dal', DEN: 'den', DET: 'det', GB: 'gb', HOU: 'hou', IND: 'ind',
  JAX: 'jax', KC: 'kc', LA: 'lar', LAR: 'lar', STL: 'lar', LAC: 'lac', SD: 'lac',
  LV: 'lv', OAK: 'lv', MIA: 'mia', MIN: 'min', NE: 'ne', NO: 'no', NYG: 'nyg',
  NYJ: 'nyj', PHI: 'phi', PIT: 'pit', SEA: 'sea', SF: 'sf', TB: 'tb', TEN: 'ten',
  WAS: 'was',
};

const POSITION_MAP: Readonly<Record<string, Position>> = {
  QB: 'QB', RB: 'RB', FB: 'RB', HB: 'RB', WR: 'WR', TE: 'TE',
};

// ---------------------------------------------------------------------------
// Load player seasons
// ---------------------------------------------------------------------------

interface RawSeason {
  playerId: string;
  name: string;
  position: Position;
  franchiseId: string;
  year: number;
  stats: SeasonStats;
  display: Record<string, number | undefined>;
}

function loadPlayerSeasons(): RawSeason[] {
  const files = readdirSync(RAW).filter((f) => /^stats_player_reg_\d{4}\.csv$/.test(f)).sort();
  const out: RawSeason[] = [];

  for (const file of files) {
    const year = Number(file.match(/(\d{4})/)![1]);
    const rows = parseCsv(join(RAW, file));

    // Team-level receiving totals, so "share of team offense" has a denominator
    // even in the seasons before nflverse computed target_share.
    const teamReceivingYards = new Map<string, number>();
    for (const r of rows) {
      const team = r.recent_team;
      if (!team) continue;
      teamReceivingYards.set(team, (teamReceivingYards.get(team) ?? 0) + (num(r.receiving_yards) ?? 0));
    }

    for (const r of rows) {
      const position = POSITION_MAP[r.position ?? ''];
      const franchiseId = TEAM_TO_FRANCHISE[r.recent_team ?? ''];
      if (!position || !franchiseId) continue;

      const stats: SeasonStats = {
        games: num(r.games),
        completions: num(r.completions),
        attempts: num(r.attempts),
        passing_yards: num(r.passing_yards),
        passing_tds: num(r.passing_tds),
        passing_interceptions: num(r.passing_interceptions),
        sacks_suffered: num(r.sacks_suffered),
        sack_yards_lost: num(r.sack_yards_lost),
        sack_fumbles_lost: num(r.sack_fumbles_lost),
        passing_epa: num(r.passing_epa),
        passing_air_yards: num(r.passing_air_yards),
        carries: num(r.carries),
        rushing_yards: num(r.rushing_yards),
        rushing_tds: num(r.rushing_tds),
        rushing_epa: num(r.rushing_epa),
        rushing_first_downs: num(r.rushing_first_downs),
        rushing_fumbles_lost: num(r.rushing_fumbles_lost),
        rushing_20: num(r.rushing_20),
        receptions: num(r.receptions),
        targets: num(r.targets),
        receiving_yards: num(r.receiving_yards),
        receiving_tds: num(r.receiving_tds),
        receiving_epa: num(r.receiving_epa),
        receiving_first_downs: num(r.receiving_first_downs),
        receiving_fumbles_lost: num(r.receiving_fumbles_lost),
        receiving_yards_after_catch: num(r.receiving_yards_after_catch),
        receiving_air_yards: num(r.receiving_air_yards),
        receiving_20: num(r.receiving_20),
        target_share: num(r.target_share),
        wopr: num(r.wopr),
        team_receiving_yards: teamReceivingYards.get(r.recent_team ?? ''),
      };

      out.push({
        playerId: r.player_id ?? '',
        name: r.player_display_name || r.player_name || 'Unknown',
        position,
        franchiseId,
        year,
        stats,
        display: stats as Record<string, number | undefined>,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Team defensive seasons
// ---------------------------------------------------------------------------

/** Seasons whose weekly rows did not match the scoreboard, reported at build time. */
const incompleteSeasons: string[] = [];

function loadDefenseSeasons(): RawSeason[] {
  const files = readdirSync(RAW).filter((f) => /^stats_team_week_\d{4}\.csv$/.test(f)).sort();
  const games = existsSync(join(RAW, 'games.csv')) ? parseCsv(join(RAW, 'games.csv')) : [];

  // Points allowed, straight from the scoreboard.
  const pointsAllowed = new Map<string, { points: number; games: number }>();
  for (const g of games) {
    if (g.game_type !== 'REG') continue;
    const season = num(g.season);
    const home = num(g.home_score);
    const away = num(g.away_score);
    if (season === undefined || home === undefined || away === undefined) continue;
    for (const [team, allowed] of [[g.home_team, away], [g.away_team, home]] as const) {
      const franchiseId = TEAM_TO_FRANCHISE[team ?? ''];
      if (!franchiseId) continue;
      const key = `${season}:${franchiseId}`;
      const entry = pointsAllowed.get(key) ?? { points: 0, games: 0 };
      entry.points += allowed as number;
      entry.games += 1;
      pointsAllowed.set(key, entry);
    }
  }

  const out: RawSeason[] = [];

  for (const file of files) {
    const year = Number(file.match(/(\d{4})/)![1]);
    const rows = parseCsv(join(RAW, file)).filter((r) => r.season_type === 'REG');

    // A row is one team's offence in one week — which is exactly what their
    // opponent's defence allowed. Aggregating by opponent_team inverts it.
    const allowed = new Map<string, Record<string, number>>();
    const own = new Map<string, Record<string, number>>();
    // How many weekly rows contributed, per team. A season missing a row would
    // otherwise under-count every summed stat while looking complete.
    const rowsSeen = new Map<string, number>();
    // Fields where even one missing weekly value makes the season total a lie.
    const incomplete = new Map<string, Set<string>>();

    const add = (map: Map<string, Record<string, number>>, key: string, field: string, value: number | undefined) => {
      if (value === undefined) {
        const missing = incomplete.get(key) ?? new Set<string>();
        missing.add(field);
        incomplete.set(key, missing);
        return;
      }
      const entry = map.get(key) ?? {};
      entry[field] = (entry[field] ?? 0) + value;
      map.set(key, entry);
    };

    /** A summed field is only usable if every contributing row supplied it. */
    const complete = (key: string, field: string): number | undefined => {
      if (incomplete.get(key)?.has(field)) return undefined;
      return (field.startsWith('def_') || field.startsWith('fumble_') ? own : allowed).get(key)?.[field];
    };

    for (const r of rows) {
      const defence = TEAM_TO_FRANCHISE[r.opponent_team ?? ''];
      const offence = TEAM_TO_FRANCHISE[r.team ?? ''];
      if (defence) rowsSeen.set(defence, (rowsSeen.get(defence) ?? 0) + 1);
      if (defence) {
        add(allowed, defence, 'pass_yards_allowed', num(r.passing_yards));
        add(allowed, defence, 'pass_attempts_faced', num(r.attempts));
        add(allowed, defence, 'rush_yards_allowed', num(r.rushing_yards));
        add(allowed, defence, 'carries_faced', num(r.carries));
        add(allowed, defence, 'pass_epa_allowed', num(r.passing_epa));
        add(allowed, defence, 'rush_epa_allowed', num(r.rushing_epa));
        add(allowed, defence, 'sacks_taken_by_opponent', num(r.sacks_suffered));
      }
      if (offence) {
        add(own, offence, 'def_sacks', num(r.def_sacks));
        add(own, offence, 'def_interceptions', num(r.def_interceptions));
        add(own, offence, 'fumble_recoveries', num(r.fumble_recovery_opp));
        add(own, offence, 'def_qb_hits', num(r.def_qb_hits));
        add(own, offence, 'def_tackles_for_loss', num(r.def_tackles_for_loss));
      }
    }

    for (const [franchiseId] of allowed) {
      const scoreboard = pointsAllowed.get(`${year}:${franchiseId}`);

      // A weekly file missing a game (nflverse's 1999 drop is short two rows)
      // would silently under-count sacks and takeaways against every other
      // team. Per-game rates absorb it; totals do not, so the season is only
      // trusted when the weekly rows match the scoreboard.
      const weeklyRows = rowsSeen.get(franchiseId) ?? 0;
      const gamesPlayed = scoreboard?.games;
      const weeklyComplete = gamesPlayed !== undefined && weeklyRows === gamesPlayed;
      if (gamesPlayed !== undefined && !weeklyComplete) {
        incompleteSeasons.push(`${year} ${franchiseId}: ${weeklyRows}/${gamesPlayed} weekly rows`);
      }

      // Never coalesce a missing half to zero (PRFAQ §10): a real, plausible
      // number is far more dangerous than an absent one.
      const sum = (...fields: (number | undefined)[]) =>
        fields.some((f) => f === undefined) ? undefined : fields.reduce((a, b) => a! + b!, 0);

      const passAttempts = complete(franchiseId, 'pass_attempts_faced');
      const sacksTaken = complete(franchiseId, 'sacks_taken_by_opponent');
      const carriesFaced = complete(franchiseId, 'carries_faced');
      const dropbacks = sum(passAttempts, sacksTaken);
      const plays = sum(dropbacks, carriesFaced);

      const stats: SeasonStats = {
        games: gamesPlayed,
        points_allowed: scoreboard?.points,
        plays_faced: plays,
        dropbacks_faced: dropbacks,
        yards_allowed: sum(
          complete(franchiseId, 'pass_yards_allowed'),
          complete(franchiseId, 'rush_yards_allowed'),
        ),
        epa_allowed: sum(
          complete(franchiseId, 'pass_epa_allowed'),
          complete(franchiseId, 'rush_epa_allowed'),
        ),
        pass_yards_allowed: complete(franchiseId, 'pass_yards_allowed'),
        pass_attempts_faced: passAttempts,
        pass_epa_allowed: complete(franchiseId, 'pass_epa_allowed'),
        rush_yards_allowed: complete(franchiseId, 'rush_yards_allowed'),
        carries_faced: carriesFaced,
        rush_epa_allowed: complete(franchiseId, 'rush_epa_allowed'),
        // Counting stats are only meaningful over a complete set of weeks.
        def_sacks: weeklyComplete ? complete(franchiseId, 'def_sacks') : undefined,
        def_interceptions: weeklyComplete ? complete(franchiseId, 'def_interceptions') : undefined,
        fumble_recoveries: weeklyComplete ? complete(franchiseId, 'fumble_recoveries') : undefined,
      };

      out.push({
        playerId: `def-${franchiseId}`,
        name: '',
        position: 'DEF',
        franchiseId,
        year,
        stats,
        display: stats as Record<string, number | undefined>,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Archetypes (chemistry inputs) — derived from where the value came from
// ---------------------------------------------------------------------------

function deriveArchetypes(
  season: RawSeason,
  rank: (metric: string, value: number | undefined) => number | null,
): Archetype[] {
  const s = season.stats;
  const out: Archetype[] = [];
  const high = (metric: string, value: number | undefined, at = 0.7) => {
    const r = rank(metric, value);
    return r !== null && r >= at;
  };

  switch (season.position) {
    case 'QB': {
      const airPerAttempt = s.passing_air_yards !== undefined && s.attempts ? s.passing_air_yards / s.attempts : undefined;
      const completionPct = s.completions !== undefined && s.attempts ? s.completions / s.attempts : undefined;
      if (high('air_per_attempt', airPerAttempt)) out.push('deep_passer');
      if (high('completion_pct', completionPct)) out.push('precision_passer');
      if (high('qb_rush', s.rushing_yards, 0.85)) out.push('dual_threat_qb');
      if (out.length === 0) out.push('precision_passer');
      break;
    }
    case 'RB': {
      if (high('rb_receptions', s.receptions, 0.75)) out.push('receiving_back');
      if (high('rb_carries', s.carries, 0.7)) out.push('power_back');
      if (high('rb_explosive', s.rushing_20, 0.8)) out.push('explosive_back');
      if (out.length === 0) out.push('power_back');
      break;
    }
    case 'WR': {
      const ypr = s.receiving_yards !== undefined && s.receptions ? s.receiving_yards / s.receptions : undefined;
      const catchRate = s.receptions !== undefined && s.targets ? s.receptions / s.targets : undefined;
      const yacShare = s.receiving_yards_after_catch !== undefined && s.receiving_yards
        ? s.receiving_yards_after_catch / s.receiving_yards : undefined;
      if (high('wr_ypr', ypr, 0.72)) out.push('vertical_receiver');
      if (high('wr_catch_rate', catchRate, 0.72)) out.push('possession_receiver');
      if (high('wr_yac_share', yacShare, 0.75)) out.push('yac_receiver');
      if (out.length === 0) out.push('possession_receiver');
      break;
    }
    case 'TE': {
      const ypr = s.receiving_yards !== undefined && s.receptions ? s.receiving_yards / s.receptions : undefined;
      out.push(high('te_ypr', ypr, 0.6) ? 'seam_te' : 'blocking_te');
      break;
    }
    case 'DEF': {
      const takeaways = (s.def_interceptions ?? 0) + (s.fumble_recoveries ?? 0);
      const ppg = s.points_allowed !== undefined && s.games ? s.points_allowed / s.games : undefined;
      if (high('def_takeaways', takeaways, 0.7)) out.push('ball_hawk_defense');
      if (high('def_sacks_rank', s.def_sacks, 0.7)) out.push('pressure_defense');
      if (ppg !== undefined) {
        const r = rank('def_ppg', ppg);
        if (r !== null && r <= 0.3) out.push('stonewall_defense');
      }
      if (out.length === 0) out.push('pressure_defense');
      break;
    }
  }
  return out.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Display stat lines
// ---------------------------------------------------------------------------

const fmt = (v: number | undefined, digits = 0): string =>
  v === undefined ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function statLines(season: RawSeason): StatLine[] {
  const s = season.stats;
  switch (season.position) {
    case 'QB':
      return [
        { label: 'YDS', value: fmt(s.passing_yards) },
        { label: 'TD', value: fmt(s.passing_tds) },
        { label: 'INT', value: fmt(s.passing_interceptions) },
        { label: 'CMP%', value: s.completions !== undefined && s.attempts ? `${((s.completions / s.attempts) * 100).toFixed(1)}` : '—' },
      ];
    case 'RB':
      return [
        { label: 'RUSH', value: fmt(s.rushing_yards) },
        { label: 'YPC', value: s.rushing_yards !== undefined && s.carries ? (s.rushing_yards / s.carries).toFixed(1) : '—' },
        { label: 'TD', value: fmt((s.rushing_tds ?? 0) + (s.receiving_tds ?? 0)) },
        { label: 'REC', value: fmt(s.receptions) },
      ];
    case 'WR':
    case 'TE':
      return [
        { label: 'REC', value: fmt(s.receptions) },
        { label: 'YDS', value: fmt(s.receiving_yards) },
        { label: 'TD', value: fmt(s.receiving_tds) },
        { label: 'YPR', value: s.receiving_yards !== undefined && s.receptions ? (s.receiving_yards / s.receptions).toFixed(1) : '—' },
      ];
    case 'DEF':
      return [
        { label: 'PPG', value: s.points_allowed !== undefined && s.games ? (s.points_allowed / s.games).toFixed(1) : '—' },
        { label: 'SACK', value: fmt(s.def_sacks) },
        { label: 'TO', value: fmt((s.def_interceptions ?? 0) + (s.fumble_recoveries ?? 0)) },
        { label: 'YPP', value: s.yards_allowed !== undefined && s.plays_faced ? (s.yards_allowed / s.plays_faced).toFixed(1) : '—' },
      ];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log('Building 18-0 dataset from', RAW);
  const players = loadPlayerSeasons();
  const defenses = loadDefenseSeasons();
  const all = [...players, ...defenses];
  console.log(`  loaded ${players.length.toLocaleString()} player-seasons, ${defenses.length} team defensive seasons`);
  if (incompleteSeasons.length > 0) {
    console.log(`  ${incompleteSeasons.length} defensive season(s) with incomplete weekly data:`);
    for (const note of incompleteSeasons.slice(0, 6)) console.log(`    ${note}`);
    console.log('    counting stats withheld for these; rate stats are unaffected');
  }

  // Group by (year, position): the era-normalization basis (PRFAQ §10).
  const groups = new Map<string, RawSeason[]>();
  for (const season of all) {
    const key = `${season.year}:${season.position}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(season);
    else groups.set(key, [season]);
  }

  /** An era is only offered if the dataset covers most of its span. */
  const MIN_ERA_COVERAGE = 0.8;

  const draft: (Omit<DatasetCard, 'rating'> & { raw: number })[] = [];
  let skipped = 0;

  for (const [key, seasons] of groups) {
    const [yearStr, positionStr] = key.split(':') as [string, Position];
    const year = Number(yearStr);
    const model = POSITION_MODELS[positionStr];
    const seasonGames = year === 2020 ? 16 : year >= 2021 ? 17 : 16;

    const qualified = seasons.filter((s) => model.qualifies(s.stats, seasonGames));
    skipped += seasons.length - qualified.length;
    if (qualified.length < 8) continue;

    const extracted = qualified.map((s) => extractMetrics(s.stats, model));
    const context = buildSeasonContext(extracted);

    // Auxiliary distributions for archetype thresholds.
    const auxiliary = new Map<string, number[]>();
    const pushAux = (metric: string, value: number | undefined) => {
      if (value === undefined || !Number.isFinite(value)) return;
      const bucket = auxiliary.get(metric) ?? [];
      bucket.push(value);
      auxiliary.set(metric, bucket);
    };
    const auxOf = (s: RawSeason): [string, number | undefined][] => {
      const st = s.stats;
      return [
        ['air_per_attempt', st.passing_air_yards !== undefined && st.attempts ? st.passing_air_yards / st.attempts : undefined],
        ['completion_pct', st.completions !== undefined && st.attempts ? st.completions / st.attempts : undefined],
        ['qb_rush', st.rushing_yards],
        ['rb_receptions', st.receptions],
        ['rb_carries', st.carries],
        ['rb_explosive', st.rushing_20],
        ['wr_ypr', st.receiving_yards !== undefined && st.receptions ? st.receiving_yards / st.receptions : undefined],
        ['wr_catch_rate', st.receptions !== undefined && st.targets ? st.receptions / st.targets : undefined],
        ['wr_yac_share', st.receiving_yards_after_catch !== undefined && st.receiving_yards ? st.receiving_yards_after_catch / st.receiving_yards : undefined],
        ['te_ypr', st.receiving_yards !== undefined && st.receptions ? st.receiving_yards / st.receptions : undefined],
        ['def_takeaways', (st.def_interceptions ?? 0) + (st.fumble_recoveries ?? 0)],
        ['def_sacks_rank', st.def_sacks],
        ['def_ppg', st.points_allowed !== undefined && st.games ? st.points_allowed / st.games : undefined],
      ];
    };
    for (const s of qualified) for (const [metric, value] of auxOf(s)) pushAux(metric, value);
    for (const values of auxiliary.values()) values.sort((a, b) => a - b);

    const rank = (metric: string, value: number | undefined): number | null => {
      const values = auxiliary.get(metric);
      if (!values || values.length < 8 || value === undefined || !Number.isFinite(value)) return null;
      return percentileRank(value, { mean: 0, stddev: 1, count: values.length, sorted: values });
    };

    for (const season of qualified) {
      const rating = rateSeason(season.stats, model, context);
      const components: DatasetComponent[] = rating.components.map((c) => ({
        k: c.key,
        s: c.score,
        w: Number(c.effectiveWeight.toFixed(3)),
        m: c.metricUsed,
        z: c.z === null ? null : Number(c.z.toFixed(2)),
      }));

      const franchise = season.franchiseId;
      const eraKey = eraForYear(season.year);
      if (!eraKey) continue;
      draft.push({
        id: `${season.playerId}-${season.year}`,
        entityId: season.position === 'DEF' ? `def-${franchise}-${season.year}` : season.playerId,
        name: season.name,
        position: season.position,
        franchiseId: franchise,
        year: season.year,
        era: eraKey,
        raw: rating.overall,
        games: season.stats.games ?? 0,
        archetypes: deriveArchetypes(season, rank),
        stats: statLines(season),
        components,
        unavailable: rating.unavailable,
      });
    }
  }

  console.log(`  ${draft.length.toLocaleString()} qualifying cards (${skipped.toLocaleString()} below the §12 floors)`);

  /**
   * One card per identity per franchise-era (PRFAQ §7).
   *
   * "The user chooses a player, not a year" — the game automatically uses that
   * player's highest-rated qualifying season for the spun franchise and era.
   * Listing every season made a spin read like a spreadsheet with the same name
   * four times.
   *
   * A team defense collapses on the franchise, not the season, for the same
   * reason: a bucket should offer *the* Ravens defense of that era, not five
   * near-identical ones.
   */
  const collapseKey = (card: (typeof draft)[number]) =>
    card.position === 'DEF'
      ? `${card.franchiseId}:${card.era}:DEF`
      : `${card.franchiseId}:${card.era}:${card.entityId}`;

  const bestPerIdentity = new Map<string, (typeof draft)[number]>();
  for (const card of draft) {
    const key = collapseKey(card);
    const held = bestPerIdentity.get(key);
    if (!held || card.raw > held.raw) bestPerIdentity.set(key, card);
  }
  const collapsedDraft = [...bestPerIdentity.values()];
  console.log(
    `  ${collapsedDraft.length.toLocaleString()} after collapsing to each identity's best season ` +
      `(${(draft.length - collapsedDraft.length).toLocaleString()} duplicates removed)`,
  );

  // Map each position's raw distribution onto the published rating scale
  // (PRFAQ §9), so a 98 means "historically dominant" rather than "top of an
  // averaged nine-component score".
  const calibrations: Record<string, PlayerCalibration> = {};
  for (const position of ['QB', 'RB', 'WR', 'TE', 'DEF'] as Position[]) {
    // Calibrated on every qualifying season, not just the surviving best ones,
    // so the published scale still means what §9 says across the whole league.
    const raws = draft.filter((d) => d.position === position).map((d) => d.raw);
    if (raws.length >= 50) calibrations[position] = fitPlayerCalibration(raws);
  }

  const cards: DatasetCard[] = collapsedDraft.map(({ raw, ...rest }) => {
    const curve = calibrations[rest.position];
    return { ...rest, rating: curve ? applyPlayerCalibration(raw, curve) : raw };
  });

  for (const position of Object.keys(calibrations)) {
    const rated = cards.filter((c) => c.position === position).map((c) => c.rating).sort((a, b) => b - a);
    console.log(
      `    ${position.padEnd(4)} n=${String(rated.length).padStart(5)}  max=${rated[0]!.toFixed(1)}` +
        `  96+=${rated.filter((r) => r >= 96).length.toString().padStart(3)}` +
        `  93+=${rated.filter((r) => r >= 93).length.toString().padStart(3)}` +
        `  median=${rated[Math.floor(rated.length / 2)]!.toFixed(1)}`,
    );
  }

  const seasonsPerEra = new Map<EraKey, Set<number>>();
  for (const card of cards) {
    const set = seasonsPerEra.get(card.era) ?? new Set<number>();
    set.add(card.year);
    seasonsPerEra.set(card.era, set);
  }
  const coveredEras = new Set<EraKey>();
  for (const definition of ERA_TABLE) {
    const years = seasonsPerEra.get(definition.key)?.size ?? 0;
    const span = definition.endYear - definition.startYear + 1;
    if (years / span >= MIN_ERA_COVERAGE) coveredEras.add(definition.key);
    else console.log(`  dropping ${definition.key}: ${years}/${span} seasons covered`);
  }

  // Only offer eras we can actually populate at every position.
  const byCombo = new Map<string, Map<Position, number>>();
  for (const card of cards) {
    if (!coveredEras.has(card.era)) continue;
    const key = `${card.franchiseId}:${card.era}`;
    const counts = byCombo.get(key) ?? new Map<Position, number>();
    counts.set(card.position, (counts.get(card.position) ?? 0) + 1);
    byCombo.set(key, counts);
  }

  const REQUIRED: [Position, number][] = [['QB', 1], ['RB', 2], ['WR', 2], ['TE', 1], ['DEF', 1]];
  const combos = [...byCombo.entries()]
    .filter(([, counts]) => REQUIRED.every(([position, min]) => (counts.get(position) ?? 0) >= min))
    .map(([key]) => {
      const [franchiseId, era] = key.split(':') as [string, EraKey];
      return { franchiseId, era, spinWeight: 1 };
    })
    .sort((a, b) => a.franchiseId.localeCompare(b.franchiseId) || a.era.localeCompare(b.era));

  const validCombo = new Set(combos.map((c) => `${c.franchiseId}:${c.era}`));
  const finalCards = cards.filter((c) => validCombo.has(`${c.franchiseId}:${c.era}`));

  const teams = parseCsv(join(RAW, 'teams.csv'));
  const franchiseIds = [...new Set(finalCards.map((c) => c.franchiseId))].sort();
  const franchises = franchiseIds.map((id) => {
    const abbr = Object.entries(TEAM_TO_FRANCHISE).find(([, v]) => v === id)?.[0] ?? id.toUpperCase();
    const row = teams.find((t) => TEAM_TO_FRANCHISE[t.team_abbr ?? ''] === id) ?? {};
    return {
      id,
      abbr: row.team_abbr ?? abbr,
      name: row.team_name ?? id,
      nick: row.team_nick ?? id,
      conference: row.team_conf ?? '',
      color: row.team_color ?? '#1a1a1a',
      color2: row.team_color2 ?? '#ffffff',
      logo: row.team_logo_espn ?? '',
    };
  });

  const years = finalCards.map((c) => c.year);
  const eraKeys = [...new Set(finalCards.map((c) => c.era))].sort();

  const dataset: Dataset = {
    version: '1.0.0',
    ratingModelVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    source: 'nflverse-data (stats_player_reg, stats_team_week, schedules), regular season only',
    coverage: { firstSeason: Math.min(...years), lastSeason: Math.max(...years) },
    eras: ERA_TABLE.filter((e) => eraKeys.includes(e.key)).map((e) => ({
      key: e.key,
      name: e.name,
      label: e.label,
      startYear: e.startYear,
      endYear: e.endYear,
      tagline: e.tagline,
    })),
    franchises,
    combos,
    cards: finalCards,
  };

  writeFileSync(OUT, JSON.stringify(dataset));
  const bytes = readFileSync(OUT).length;
  console.log(`  ${combos.length} valid franchise-era combos across ${eraKeys.length} eras`);
  console.log(`  wrote ${OUT} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
}

main();
