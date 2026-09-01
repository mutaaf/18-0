import { ERA_KEYS, type Era, type EraKey, type FranchiseEra } from '../types.js';

/**
 * Franchise lineage start years. Relocations inherit the lineage (Baltimore
 * Colts -> Indianapolis, Houston Oilers -> Tennessee) so the wheel can offer
 * IND + 1950s without offering JAX + 1970s (PRFAQ §6.2).
 */
export interface SimFranchise {
  readonly id: string;
  readonly abbreviation: string;
  readonly displayName: string;
  readonly activeFrom: number;
}

export const SIM_FRANCHISES: readonly SimFranchise[] = [
  { id: 'ari', abbreviation: 'ARI', displayName: 'Arizona Cardinals', activeFrom: 1920 },
  { id: 'atl', abbreviation: 'ATL', displayName: 'Atlanta Falcons', activeFrom: 1966 },
  { id: 'bal', abbreviation: 'BAL', displayName: 'Baltimore Ravens', activeFrom: 1996 },
  { id: 'buf', abbreviation: 'BUF', displayName: 'Buffalo Bills', activeFrom: 1960 },
  { id: 'car', abbreviation: 'CAR', displayName: 'Carolina Panthers', activeFrom: 1995 },
  { id: 'chi', abbreviation: 'CHI', displayName: 'Chicago Bears', activeFrom: 1920 },
  { id: 'cin', abbreviation: 'CIN', displayName: 'Cincinnati Bengals', activeFrom: 1968 },
  { id: 'cle', abbreviation: 'CLE', displayName: 'Cleveland Browns', activeFrom: 1946 },
  { id: 'dal', abbreviation: 'DAL', displayName: 'Dallas Cowboys', activeFrom: 1960 },
  { id: 'den', abbreviation: 'DEN', displayName: 'Denver Broncos', activeFrom: 1960 },
  { id: 'det', abbreviation: 'DET', displayName: 'Detroit Lions', activeFrom: 1930 },
  { id: 'gb', abbreviation: 'GB', displayName: 'Green Bay Packers', activeFrom: 1921 },
  { id: 'hou', abbreviation: 'HOU', displayName: 'Houston Texans', activeFrom: 2002 },
  { id: 'ind', abbreviation: 'IND', displayName: 'Indianapolis Colts', activeFrom: 1953 },
  { id: 'jax', abbreviation: 'JAX', displayName: 'Jacksonville Jaguars', activeFrom: 1995 },
  { id: 'kc', abbreviation: 'KC', displayName: 'Kansas City Chiefs', activeFrom: 1960 },
  { id: 'lac', abbreviation: 'LAC', displayName: 'Los Angeles Chargers', activeFrom: 1960 },
  { id: 'lar', abbreviation: 'LAR', displayName: 'Los Angeles Rams', activeFrom: 1937 },
  { id: 'lv', abbreviation: 'LV', displayName: 'Las Vegas Raiders', activeFrom: 1960 },
  { id: 'mia', abbreviation: 'MIA', displayName: 'Miami Dolphins', activeFrom: 1966 },
  { id: 'min', abbreviation: 'MIN', displayName: 'Minnesota Vikings', activeFrom: 1961 },
  { id: 'ne', abbreviation: 'NE', displayName: 'New England Patriots', activeFrom: 1960 },
  { id: 'no', abbreviation: 'NO', displayName: 'New Orleans Saints', activeFrom: 1967 },
  { id: 'nyg', abbreviation: 'NYG', displayName: 'New York Giants', activeFrom: 1925 },
  { id: 'nyj', abbreviation: 'NYJ', displayName: 'New York Jets', activeFrom: 1960 },
  { id: 'phi', abbreviation: 'PHI', displayName: 'Philadelphia Eagles', activeFrom: 1933 },
  { id: 'pit', abbreviation: 'PIT', displayName: 'Pittsburgh Steelers', activeFrom: 1933 },
  { id: 'sea', abbreviation: 'SEA', displayName: 'Seattle Seahawks', activeFrom: 1976 },
  { id: 'sf', abbreviation: 'SF', displayName: 'San Francisco 49ers', activeFrom: 1946 },
  { id: 'tb', abbreviation: 'TB', displayName: 'Tampa Bay Buccaneers', activeFrom: 1976 },
  { id: 'ten', abbreviation: 'TEN', displayName: 'Tennessee Titans', activeFrom: 1960 },
  { id: 'was', abbreviation: 'WAS', displayName: 'Washington Commanders', activeFrom: 1932 },
];

export const ERAS: readonly Era[] = ERA_KEYS.map((key, index) => {
  const startYear = 1950 + index * 10;
  return {
    key,
    label: key,
    startYear,
    endYear: startYear + 9,
    sortOrder: index,
  };
});

export const ERA_BY_KEY = new Map(ERAS.map((e) => [e.key, e]));

/** Only combinations the franchise actually played are valid wheel outcomes. */
export function validFranchiseEras(): FranchiseEra[] {
  const combos: FranchiseEra[] = [];
  for (const franchise of SIM_FRANCHISES) {
    for (const era of ERAS) {
      if (franchise.activeFrom <= era.endYear) {
        combos.push({ franchiseId: franchise.id, era: era.key, spinWeight: 1 });
      }
    }
  }
  return combos;
}

export function bucketKey(franchiseId: string, era: EraKey): string {
  return `${franchiseId}:${era}`;
}
