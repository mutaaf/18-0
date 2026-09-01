import type { Ending } from '../types.js';

/**
 * Complete season ending taxonomy (PRFAQ §19).
 *
 * Every one of the 19 possible 18-game records has a name and a tier. Ordered
 * worst to best; index is the win total.
 */
export const ENDINGS: readonly Ending[] = [
  { key: 'HISTORIC_COLLAPSE', label: 'Historic Collapse', tier: 'F', wins: 0, losses: 18 },
  { key: 'ROCK_BOTTOM', label: 'Rock Bottom', tier: 'F', wins: 1, losses: 17 },
  { key: 'REBUILD', label: 'Rebuild', tier: 'F', wins: 2, losses: 16 },
  { key: 'LOST_SEASON', label: 'Lost Season', tier: 'D', wins: 3, losses: 15 },
  { key: 'BOTTOM_FEEDER', label: 'Bottom Feeder', tier: 'D', wins: 4, losses: 14 },
  { key: 'STRUGGLING', label: 'Struggling', tier: 'D', wins: 5, losses: 13 },
  { key: 'UNDERACHIEVER', label: 'Underachiever', tier: 'C-', wins: 6, losses: 12 },
  { key: 'FRINGE', label: 'Fringe', tier: 'C', wins: 7, losses: 11 },
  { key: 'ALMOST_THERE', label: 'Almost There', tier: 'C+', wins: 8, losses: 10 },
  { key: 'AVERAGE', label: 'Average', tier: 'B-', wins: 9, losses: 9 },
  { key: 'WINNING_SEASON', label: 'Winning Season', tier: 'B', wins: 10, losses: 8 },
  { key: 'WILD_CARD', label: 'Wild Card', tier: 'B+', wins: 11, losses: 7 },
  { key: 'PLAYOFF_TEAM', label: 'Playoff Team', tier: 'A-', wins: 12, losses: 6 },
  { key: 'CONTENDER', label: 'Contender', tier: 'A', wins: 13, losses: 5 },
  { key: 'ELITE', label: 'Elite', tier: 'A', wins: 14, losses: 4 },
  { key: 'CHAMPIONSHIP_CALIBER', label: 'Championship Caliber', tier: 'A+', wins: 15, losses: 3 },
  { key: 'DYNASTY', label: 'Dynasty', tier: 'S', wins: 16, losses: 2 },
  { key: 'HEARTBREAK', label: 'Heartbreak', tier: 'S+', wins: 17, losses: 1 },
  { key: 'PERFECT', label: 'Perfect', tier: 'IMMORTAL', wins: 18, losses: 0 },
] as const;

const BY_KEY = new Map(ENDINGS.map((e) => [e.key, e]));

export function endingByKey(key: string): Ending {
  const ending = BY_KEY.get(key);
  if (!ending) throw new Error(`Unknown ending key: ${key}`);
  return ending;
}

export function endingByWins(wins: number): Ending {
  const ending = ENDINGS[wins];
  if (!ending) throw new Error(`No ending for win total: ${wins}`);
  return ending;
}

/** 17-1 and 18-0 get dedicated emotional reveal states (PRFAQ §22.4). */
export const HEARTBREAK_KEY = 'HEARTBREAK';
export const PERFECT_KEY = 'PERFECT';
