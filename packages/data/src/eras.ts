import type { EraKey } from '@18-0/domain';

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
