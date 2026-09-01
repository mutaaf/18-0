import type { EraKey } from '@18-0/domain';

/**
 * The era table.
 *
 * PRFAQ §6.2 proposed decades, which only yields three usable buckets from the
 * seasons open data actually covers (1999-2025) — too little spin variety for a
 * game whose whole premise is "spin history". These five periods cut the same
 * real data into franchise-eras that are both more numerous and more
 * evocative: a fan knows exactly what "PIT '05-'09" means.
 *
 * Pre-1999 remains unavailable: Pro-Football-Reference is the only complete
 * source back to 1920 and it blocks automated access. See docs/FINDINGS.md.
 */
export interface EraDefinition {
  readonly key: EraKey;
  readonly label: string;
  readonly startYear: number;
  readonly endYear: number;
  /** A one-line hook for the spin card. */
  readonly tagline: string;
}

export const ERA_TABLE: readonly EraDefinition[] = [
  { key: '1999_2004', label: "'99–'04", startYear: 1999, endYear: 2004, tagline: 'The Greatest Show and the dynasty forming' },
  { key: '2005_2009', label: "'05–'09", startYear: 2005, endYear: 2009, tagline: 'Steel, Colts and the perfect regular season' },
  { key: '2010_2014', label: "'10–'14", startYear: 2010, endYear: 2014, tagline: 'Offense unleashed, Legion of Boom' },
  { key: '2015_2019', label: "'15–'19", startYear: 2015, endYear: 2019, tagline: 'Brady late, Mahomes early' },
  { key: '2020_2025', label: "'20–'25", startYear: 2020, endYear: 2025, tagline: 'The modern game' },
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

export function eraLabel(key: EraKey): string {
  return BY_KEY.get(key)?.label ?? key;
}
