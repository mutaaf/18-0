import type { EraKey } from '@18-0/domain';
import { FRANCHISE_ERA_RECORD } from './franchise-era-records.js';

/**
 * The era table.
 *
 * PRFAQ §6.2 proposed decades, which only yields three usable buckets from the
 * seasons open data covers (1999-2025). These five periods cut the same real
 * data into franchise-eras that are both more numerous and more evocative — a
 * fan should read the spin card and immediately picture the football.
 *
 * Each era is named for the thing it is actually remembered for, not for its
 * date range. The dates are the fine print.
 *
 * 1980-1998 comes from NFL.com's published statistics (see `legacy.ts`) and is
 * thinner than nflverse — no EPA, no targets. Because normalization is per era,
 * every card inside those eras is scored on the same basis as its neighbours.
 */
export interface EraDefinition {
  readonly key: EraKey;
  /** The name a fan would use. Shown large on the spin card. */
  readonly name: string;
  /** The year range, shown as supporting detail. */
  readonly label: string;
  readonly startYear: number;
  readonly endYear: number;
  /** One line on what defined it. */
  readonly tagline: string;
}

export const ERA_TABLE: readonly EraDefinition[] = [
  {
    key: '1980_1989',
    name: 'The 46 and the Catch',
    label: '1980–1989',
    startYear: 1980,
    endYear: 1989,
    tagline: "Montana's dynasty, and the most feared defence ever fielded",
  },
  {
    key: '1990_1998',
    name: 'Three Rings and Four Falls',
    label: '1990–1998',
    startYear: 1990,
    endYear: 1998,
    tagline: "Dallas's three, Buffalo's four straight heartbreaks, Sanders in full flight",
  },
  {
    key: '1999_2004',
    name: 'The Indoor Years',
    label: "1999–2004",
    startYear: 1999,
    endYear: 2004,
    tagline: 'St. Louis outscoring everyone, Baltimore\'s record defense answering',
  },
  {
    key: '2005_2009',
    name: 'Chasing Perfect',
    label: '2005–2009',
    startYear: 2005,
    endYear: 2009,
    tagline: 'Manning against Brady, 16-0, and the one that got away',
  },
  {
    key: '2010_2014',
    name: 'The Passing Boom',
    label: '2010–2014',
    startYear: 2010,
    endYear: 2014,
    tagline: '5,000-yard seasons, until Seattle\'s secondary answered',
  },
  {
    key: '2015_2019',
    name: 'The Torch Pass',
    label: '2015–2019',
    startYear: 2015,
    endYear: 2019,
    tagline: '28-3, and a kid from Texas Tech taking the league',
  },
  {
    key: '2020_2025',
    name: 'The Long Season',
    label: '2020–2025',
    startYear: 2020,
    endYear: 2025,
    tagline: 'Kansas City on top, and a seventeenth game',
  },
];

const BY_KEY = new Map(ERA_TABLE.map((e) => [e.key, e]));

export function eraForYear(year: number): EraKey | null {
  for (const era of ERA_TABLE) {
    if (year >= era.startYear && year <= era.endYear) return era.key;
  }
  return null;
}

export function era(key: EraKey): EraDefinition {
  const found = BY_KEY.get(key);
  if (!found) throw new Error(`Unknown era: ${key}`);
  return found;
}

export function eraName(key: EraKey): string {
  return BY_KEY.get(key)?.name ?? key;
}

export function eraLabel(key: EraKey): string {
  return BY_KEY.get(key)?.label ?? key;
}

/**
 * What a franchise-era is actually remembered for.
 *
 * The spin card needs a line about the card you were dealt. The two generated
 * options are both compromises: the highest-rated players in the pool is the
 * game's own answer key and cannot be shown in Player IQ, and the pool's shape
 * is true but dry. A real one beats both.
 *
 * Three rules for anything added here.
 *
 * 1. **No player names.** "Burrow and Chase" is the same leak as the generated
 *    line wearing a different hat: those are the two highest-rated Bengals
 *    cards of the era. Unit nicknames are fine — a fan knowing the Legion of
 *    Boom was a secondary is football knowledge, which is the thing Player IQ
 *    is asking for, not a readout of this game's ratings.
 * 2. **Checked, not remembered.** Every line below was verified against a
 *    source rather than written from memory. `docs/FINDINGS.md` says the same
 *    thing about stats, for the same reason.
 * 3. **It must fit the era bucket.** The Greatest Show on Turf ran 1999-2001,
 *    which sits inside 1999-2004. A nickname straddling two buckets belongs in
 *    neither.
 *
 * Coverage is deliberately partial: 157 franchise-eras exist and most have no
 * story worth telling. Anything absent falls back to the generated line, so
 * this table can grow one verified entry at a time.
 */
export const FRANCHISE_ERA_STORY: Readonly<Record<string, string>> = {
  // Rams 1999-2001: record scoring, two Super Bowl trips, one title.
  'lar:1999_2004': 'The Greatest Show on Turf.',
  // 165 points allowed in 2000, still the 16-game record, then Super Bowl XXXV.
  'bal:1999_2004': 'Gave up 165 points in 2000. Nobody has beaten that.',
  // The Tampa 2, and a 48-21 win over Oakland in Super Bowl XXXVII.
  'tb:1999_2004': 'The Tampa 2, and Super Bowl XXXVII.',
  // 16-0 in the 2007 regular season; 589 points stood as the record until 2013.
  'ne:2005_2009': 'Went 16-0 in 2007, and scored more than anyone ever had.',
  // Super Bowl XLIV, after the 2009 season.
  'no:2005_2009': 'Who Dat, and a first Super Bowl.',
  // 606 points in 2013, the NFL record.
  'den:2010_2014': 'Scored 606 points in 2013. Still the record.',
  'sea:2010_2014': 'The Legion of Boom.',
  'den:2015_2019': 'The No Fly Zone.',
  // The Philly Special, Super Bowl LII, the franchise's first title.
  'phi:2015_2019': 'The Philly Special, and a first title at last.',
  // First run in 2021, and never really stopped.
  'phi:2020_2025': 'The Tush Push.',
  // 10-7, the AFC North, and Super Bowl LVI after the 2021 season.
  'cin:2020_2025': 'Worst to the Super Bowl in two years.',
};

/**
 * The line for a franchise-era.
 *
 * The hand-written table wins where it has an entry, because "The Legion of
 * Boom" beats a win-loss record. Everything else falls through to the computed
 * one, so all 157 have something true to say and nothing has to fall back to
 * naming players.
 */
export function franchiseEraStory(franchiseId: string, era: string): string {
  const key = `${franchiseId}:${era}`;
  return FRANCHISE_ERA_STORY[key] ?? FRANCHISE_ERA_RECORD[key] ?? '';
}
