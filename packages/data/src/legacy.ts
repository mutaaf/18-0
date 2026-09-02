import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Position, SeasonStats } from '@18-0/domain';

/**
 * Pre-1999 seasons, from NFL.com's own published statistics.
 *
 * nflverse starts at 1999. This fills 1980-1998 from a public mirror of
 * NFL.com's season leaderboards, pulled once and vendored under `data/raw/nfl`
 * so nothing re-fetches. It is a proof of concept for the older eras; a
 * licensed source is the intended path before this is anything but that.
 *
 * The older data is thinner than nflverse — no EPA, no targets, no play-by-play
 * — so the rating models fall back to the metrics that do exist. Because
 * normalization happens per era (see `build.ts`), every card inside a
 * pre-1999 era is scored on the same basis as its neighbours, which is what
 * matters for comparing cards in a spin.
 */

const LEGACY_DIR = 'nfl';

/** Every franchise name NFL.com has used since 1980, mapped to its lineage. */
const TEAM_TO_FRANCHISE: Readonly<Record<string, string>> = {
  'Arizona Cardinals': 'ari',
  'Phoenix Cardinals': 'ari',
  'St. Louis Cardinals': 'ari',
  'Atlanta Falcons': 'atl',
  'Baltimore Ravens': 'bal',
  'Buffalo Bills': 'buf',
  'Carolina Panthers': 'car',
  'Chicago Bears': 'chi',
  'Cincinnati Bengals': 'cin',
  'Cleveland Browns': 'cle',
  'Dallas Cowboys': 'dal',
  'Denver Broncos': 'den',
  'Detroit Lions': 'det',
  'Green Bay Packers': 'gb',
  'Houston Texans': 'hou',
  'Indianapolis Colts': 'ind',
  'Baltimore Colts': 'ind',
  'Jacksonville Jaguars': 'jax',
  'Kansas City Chiefs': 'kc',
  'Los Angeles Chargers': 'lac',
  'San Diego Chargers': 'lac',
  'Los Angeles Rams': 'lar',
  'St. Louis Rams': 'lar',
  'Las Vegas Raiders': 'lv',
  'Oakland Raiders': 'lv',
  'Los Angeles Raiders': 'lv',
  'Miami Dolphins': 'mia',
  'Minnesota Vikings': 'min',
  'New England Patriots': 'ne',
  'New Orleans Saints': 'no',
  'New York Giants': 'nyg',
  'New York Jets': 'nyj',
  'Philadelphia Eagles': 'phi',
  'Pittsburgh Steelers': 'pit',
  'Seattle Seahawks': 'sea',
  'San Francisco 49ers': 'sf',
  'Tampa Bay Buccaneers': 'tb',
  'Tennessee Titans': 'ten',
  'Tennessee Oilers': 'ten',
  'Houston Oilers': 'ten',
  'Washington Commanders': 'was',
  'Washington Football Team': 'was',
  'Washington Redskins': 'was',
};

/** The three-letter codes the game logs use for opponents. */
const ABBR_TO_FRANCHISE: Readonly<Record<string, string>> = {
  ARI: 'ari', PHO: 'ari', STL: 'lar', ATL: 'atl', BAL: 'bal', BUF: 'buf', CAR: 'car',
  CHI: 'chi', CIN: 'cin', CLE: 'cle', DAL: 'dal', DEN: 'den', DET: 'det', GB: 'gb',
  HOU: 'ten', IND: 'ind', JAX: 'jax', KC: 'kc', LA: 'lar', LAC: 'lac', LARM: 'lar',
  LARD: 'lv', MIA: 'mia', MIN: 'min', NE: 'ne', NO: 'no', NYG: 'nyg', NYJ: 'nyj',
  OAK: 'lv', PHI: 'phi', PIT: 'pit', SD: 'lac', SEA: 'sea', SF: 'sf', TB: 'tb',
  TEN: 'ten', WAS: 'was', LV: 'lv',
};

export interface LegacySeason {
  playerId: string;
  name: string;
  position: Position;
  franchiseId: string;
  year: number;
  stats: SeasonStats;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf8');
  const rows: Record<string, string>[] = [];
  let header: string[] | null = null;
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    if (record.length === 1 && record[0] === '') {
      record = [];
      return;
    }
    if (!header) header = record;
    else rows.push(Object.fromEntries(header.map((h, i) => [h, record[i] ?? ''])));
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') pushField();
    else if (ch === '\n') pushRecord();
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || record.length > 0) pushRecord();
  return rows;
}

/** NFL.com writes thousands with commas and missing values as `--`. */
const num = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const cleaned = v.replace(/,/g, '').replace(/%/g, '').trim();
  if (cleaned === '' || cleaned === '--') return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Names arrive as "Largent, Steve". */
const flipName = (name: string): string => {
  const [last, first] = name.split(',').map((s) => s.trim());
  return first ? `${first} ${last}` : name;
};

// ---------------------------------------------------------------------------
// Team defence, derived from game scores
// ---------------------------------------------------------------------------

interface TeamSeasonScore {
  points: number;
  games: number;
}

/**
 * Points allowed per team-season.
 *
 * Every game-log row carries `Score` as "own to opponent" for the player's own
 * team, so one row per team per week is enough. Rows are deduplicated on
 * (year, team, week) because several players share a game.
 */
function loadPointsAllowed(dir: string, careerTeams: Map<string, string>): Map<string, TeamSeasonScore> {
  const logs = parseCsv(join(dir, 'Game_Logs_Quarterback.csv'));
  const seen = new Set<string>();
  const out = new Map<string, TeamSeasonScore>();

  for (const row of logs) {
    if (row.Season !== 'Regular Season') continue;
    const year = num(row.Year);
    if (year === undefined) continue;

    // The log does not name the player's own team, so it comes from the career
    // file via the player id.
    const franchiseId = careerTeams.get(`${row['Player Id']}:${year}`);
    if (!franchiseId) continue;

    const key = `${year}:${franchiseId}:${row.Week}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const [, allowedRaw] = (row.Score ?? '').split(' to ');
    const allowed = num(allowedRaw);
    if (allowed === undefined) continue;

    const seasonKey = `${year}:${franchiseId}`;
    const entry = out.get(seasonKey) ?? { points: 0, games: 0 };
    entry.points += allowed;
    entry.games += 1;
    out.set(seasonKey, entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Positions for pre-1999 players.
 *
 * NFL.com's season files carry no position at all for these years — the column
 * is empty for every one of the 4,949 receiving rows in this range — so every
 * tight end would be indistinguishable from a wide receiver. nflverse publishes
 * rosters back to 1920 with clean positions, so they are joined on name and
 * season. Without this the older eras have no tight ends, and a roster needs
 * one.
 */
function loadRosterPositions(rawDir: string, firstYear: number, lastYear: number): Map<string, string> {
  const normalise = (name: string) =>
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const bySeason = new Map<string, string>();
  for (let year = firstYear; year <= lastYear; year++) {
    let rows: Record<string, string>[];
    try {
      rows = parseCsv(join(rawDir, LEGACY_DIR, `roster_${year}.csv`));
    } catch {
      continue;
    }
    for (const row of rows) {
      const position = (row.position ?? '').trim().toUpperCase();
      const name = row.full_name ?? '';
      if (!position || !name) continue;
      bySeason.set(`${year}:${normalise(name)}`, position);
      // A name-only fallback covers rows whose season is off by one because the
      // player changed teams mid-year.
      if (!bySeason.has(normalise(name))) bySeason.set(normalise(name), position);
    }
  }
  return bySeason;
}

const normaliseName = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function loadLegacySeasons(rawDir: string, firstYear = 1980, lastYear = 1998): LegacySeason[] {
  const dir = join(rawDir, LEGACY_DIR);
  const inRange = (row: Record<string, string>) => {
    const year = num(row.Year);
    return year !== undefined && year >= firstYear && year <= lastYear;
  };
  const franchiseOf = (row: Record<string, string>) => TEAM_TO_FRANCHISE[row.Team ?? ''];

  const passing = parseCsv(join(dir, 'Career_Stats_Passing.csv')).filter(inRange);
  const rushing = parseCsv(join(dir, 'Career_Stats_Rushing.csv')).filter(inRange);
  const receiving = parseCsv(join(dir, 'Career_Stats_Receiving.csv')).filter(inRange);
  const defensive = parseCsv(join(dir, 'Career_Stats_Defensive.csv')).filter(inRange);
  const basic = parseCsv(join(dir, 'Basic_Stats.csv'));

  const positionById = new Map(basic.map((b) => [b['Player Id'] ?? '', (b.Position ?? '').trim()]));
  const rosterPositions = loadRosterPositions(rawDir, firstYear, lastYear);

  // Player id + year -> franchise, used to attribute game-log scores.
  const careerTeams = new Map<string, string>();
  for (const row of [...passing, ...rushing, ...receiving, ...defensive]) {
    const franchiseId = franchiseOf(row);
    if (franchiseId) careerTeams.set(`${row['Player Id']}:${num(row.Year)}`, franchiseId);
  }

  const pointsAllowed = loadPointsAllowed(dir, careerTeams);
  const out: LegacySeason[] = [];

  // --- team receiving totals, so share-of-offence has a denominator ---------
  const teamReceivingYards = new Map<string, number>();
  for (const row of receiving) {
    const franchiseId = franchiseOf(row);
    if (!franchiseId) continue;
    const key = `${num(row.Year)}:${franchiseId}`;
    teamReceivingYards.set(key, (teamReceivingYards.get(key) ?? 0) + (num(row['Receiving Yards']) ?? 0));
  }

  // Keyed by team as well as year: a player traded mid-season has two rows, and
  // keying on player-year alone silently kept whichever came last (Dickerson's
  // 1987 was half a Rams season and half a Colts one).
  const keyOf = (r: Record<string, string>) =>
    `${r['Player Id']}:${num(r.Year)}:${TEAM_TO_FRANCHISE[r.Team ?? ''] ?? r.Team}`;

  // Quarterback rushing lives in the rushing file, so it is merged in below.
  const rushingByKey = new Map(rushing.map((r) => [keyOf(r), r]));

  // --- quarterbacks --------------------------------------------------------
  for (const row of passing) {
    const franchiseId = franchiseOf(row);
    const year = num(row.Year);
    if (!franchiseId || year === undefined) continue;
    const attempts = num(row['Passes Attempted']);
    if (attempts === undefined) continue;
    // A halfback option pass would otherwise mint a quarterback card: Jerry
    // Rice threw twice in 1986 and arrived here as a QB. Only players the
    // roster calls a quarterback, or who threw like one, get through.
    const declaredQb = rosterPositions.get(`${year}:${normaliseName(flipName(row.Name ?? ''))}`);
    if (declaredQb ? declaredQb !== 'QB' : attempts < 100) continue;

    out.push({
      playerId: row['Player Id'] ?? '',
      name: flipName(row.Name ?? ''),
      position: 'QB',
      franchiseId,
      year,
      stats: {
        games: num(row['Games Played']),
        attempts,
        completions: num(row['Passes Completed']),
        passing_yards: num(row['Passing Yards']),
        passing_tds: num(row['TD Passes']),
        passing_interceptions: num(row.Ints),
        sacks_suffered: num(row.Sacks),
        sack_yards_lost: num(row['Sacked Yards Lost']),
        rushing_yards: num(rushingByKey.get(keyOf(row))?.['Rushing Yards']),
        rushing_tds: num(rushingByKey.get(keyOf(row))?.['Rushing TDs']),
        rushing_fumbles_lost: num(rushingByKey.get(keyOf(row))?.Fumbles),
      },
    });
  }

  // --- runners and receivers -----------------------------------------------
  const rushingById = rushingByKey;
  const receivingById = new Map(receiving.map((r) => [keyOf(r), r]));
  const skillKeys = new Set([...rushingById.keys(), ...receivingById.keys()]);

  for (const key of skillKeys) {
    const rush = rushingById.get(key);
    const rec = receivingById.get(key);
    const row = rec ?? rush!;
    const franchiseId = franchiseOf(row);
    const year = num(row.Year);
    if (!franchiseId || year === undefined) continue;

    const carries = num(rush?.['Rushing Attempts']);
    const receptions = num(rec?.Receptions);
    const flipped = normaliseName(flipName(row.Name ?? ''));
    const declared = (
      rosterPositions.get(`${year}:${flipped}`) ??
      rosterPositions.get(flipped) ??
      positionById.get(row['Player Id'] ?? '') ??
      row.Position ??
      ''
    ).toUpperCase();

    // Position comes from the roster join where it exists; otherwise from how
    // the player was actually used.
    let position: Position | null = null;
    if (declared === 'TE') position = 'TE';
    else if (declared === 'WR') position = 'WR';
    else if (declared === 'RB' || declared === 'FB' || declared === 'HB') position = 'RB';
    else if (declared === 'QB' || declared === 'K' || declared === 'SPEC') position = null;
    else if (declared && !['WR', 'TE', 'RB', 'FB', 'HB'].includes(declared)) position = null;
    else if ((carries ?? 0) >= (receptions ?? 0) * 2 && (carries ?? 0) > 20) position = 'RB';
    else if ((receptions ?? 0) > 0) position = 'WR';
    if (!position) continue;

    out.push({
      playerId: row['Player Id'] ?? '',
      name: flipName(row.Name ?? ''),
      position,
      franchiseId,
      year,
      stats: {
        games: num(row['Games Played']),
        carries,
        rushing_yards: num(rush?.['Rushing Yards']),
        rushing_tds: num(rush?.['Rushing TDs']),
        rushing_first_downs: num(rush?.['Rushing First Downs']),
        rushing_20: num(rush?.['Rushing More Than 20 Yards']),
        rushing_fumbles_lost: num(rush?.Fumbles),
        receptions,
        receiving_yards: num(rec?.['Receiving Yards']),
        receiving_tds: num(rec?.['Receiving TDs']),
        receiving_first_downs: num(rec?.['First Down Receptions']),
        receiving_20: num(rec?.['Receptions Longer than 20 Yards']),
        receiving_fumbles_lost: num(rec?.Fumbles),
        team_receiving_yards: teamReceivingYards.get(`${year}:${franchiseId}`),
      },
    });
  }

  // --- team defences --------------------------------------------------------
  const teamDefence = new Map<string, { sacks: number; ints: number }>();
  for (const row of defensive) {
    const franchiseId = franchiseOf(row);
    const year = num(row.Year);
    if (!franchiseId || year === undefined) continue;
    const key = `${year}:${franchiseId}`;
    const entry = teamDefence.get(key) ?? { sacks: 0, ints: 0 };
    entry.sacks += num(row.Sacks) ?? 0;
    entry.ints += num(row.Ints) ?? 0;
    teamDefence.set(key, entry);
  }

  for (const [key, scoreboard] of pointsAllowed) {
    const [yearStr, franchiseId] = key.split(':') as [string, string];
    const year = Number(yearStr);
    if (year < firstYear || year > lastYear) continue;
    // A season missing weeks would under-count everything; require a full one.
    if (scoreboard.games < 14) continue;

    const own = teamDefence.get(key);
    out.push({
      playerId: `def-${franchiseId}`,
      name: '',
      position: 'DEF',
      franchiseId,
      year,
      stats: {
        games: scoreboard.games,
        points_allowed: scoreboard.points,
        def_sacks: own?.sacks,
        def_interceptions: own?.ints,
      },
    });
  }

  return out;
}

export { ABBR_TO_FRANCHISE };
