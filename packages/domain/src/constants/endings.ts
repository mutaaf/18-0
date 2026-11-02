import type { Ending } from '../types.js';

/** A season is 17 games: 18 weeks, one of them a bye. Legacy models used 18. */
export type SeasonGames = 17 | 18;

/**
 * The 18-game taxonomy (PRFAQ §19), frozen for the 1.2.0 and 1.3.0 models.
 *
 * Every season played before the game became 17-0 was scored against this
 * table, and `scoringConfigForVersion` must keep re-reading those seasons as
 * the 18-game records they were published as. Do not edit it.
 */
export const ENDINGS_18_GAME: readonly Ending[] = [
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

/**
 * The 17-game taxonomy: every one of the 18 possible records, worst to best,
 * index = wins.
 *
 * Derived from the 18-game table by removing AVERAGE, because a 9-9 season
 * cannot happen in 17 games, and re-counting the wins. Every other ending
 * keeps its key, label and tier, so PERFECT is still the top of the table
 * (now 17-0) and HEARTBREAK is still one short of it (now 16-1).
 */
export const ENDINGS: readonly Ending[] = ENDINGS_18_GAME.filter(
  (e) => e.key !== 'AVERAGE',
).map((e, wins) => ({ ...e, wins, losses: 17 - wins }));

export function endingsForSeason(games: SeasonGames): readonly Ending[] {
  return games === 18 ? ENDINGS_18_GAME : ENDINGS;
}

const BY_KEY: Record<SeasonGames, Map<string, Ending>> = {
  17: new Map(ENDINGS.map((e) => [e.key, e])),
  18: new Map(ENDINGS_18_GAME.map((e) => [e.key, e])),
};

export function endingByKey(key: string, games: SeasonGames = 17): Ending {
  const ending = BY_KEY[games].get(key);
  if (!ending) throw new Error(`Unknown ending key for a ${games}-game season: ${key}`);
  return ending;
}

export function endingByWins(wins: number, games: SeasonGames = 17): Ending {
  const ending = endingsForSeason(games)[wins];
  if (!ending) throw new Error(`No ending for win total: ${wins}`);
  return ending;
}

/** 16-1 and 17-0 (17-1 and 18-0 in legacy seasons) get dedicated emotional reveal states (PRFAQ §22.4). */
export const HEARTBREAK_KEY = 'HEARTBREAK';
export const PERFECT_KEY = 'PERFECT';
