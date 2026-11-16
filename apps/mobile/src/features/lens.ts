/**
 * Which lens to suggest next, from how the player has actually been doing.
 *
 * Everyone starts in Scout. A player who keeps clearing it should be offered
 * GM Mode (no stat lines); one who keeps falling short should be offered Rookie
 * (every rating on screen) to learn what wins -- and the same one step back up
 * or down from the ends. Never more than one step, never on a hunch: it waits
 * for a few seasons in the lens the player is in, reads their recent average
 * record, and stays quiet for a while after a "Not now".
 *
 * Pure, so the thresholds are tested rather than remembered, and so changing
 * them is a one-line change with a test that says what it now means.
 */

/** The three lenses a player chooses between. Gameday is its own way in. */
export type Lens = 'rookie' | 'scout' | 'player_iq';

/** What a season needs to say about itself for this to read it. */
export interface LensSeason {
  readonly mode?: string;
  readonly wins: number;
  readonly assisted?: boolean;
}

export interface LensSuggestion {
  readonly from: Lens;
  readonly to: Lens;
  readonly direction: 'up' | 'down';
  /** The average wins over the seasons it read, rounded to a whole game. */
  readonly averageWins: number;
}

/** Seasons read, most recent first, and how many it needs before it speaks. */
export const LENS_WINDOW = 5;
export const LENS_MIN_SEASONS = 3;
/** Seasons of silence after a "Not now". */
export const LENS_SNOOZE = 5;

/**
 * The bars, in wins out of 17. A typical season lands around 8-10; 12 is a
 * contender, and 6 or fewer is a lens hiding too much from this player.
 */
export const LENS_UP: Partial<Record<Lens, { to: Lens; atLeast: number }>> = {
  rookie: { to: 'scout', atLeast: 11 },
  scout: { to: 'player_iq', atLeast: 12 },
};
export const LENS_DOWN: Partial<Record<Lens, { to: Lens; atMost: number }>> = {
  player_iq: { to: 'scout', atMost: 7 },
  scout: { to: 'rookie', atMost: 6 },
};

export const isLens = (mode: unknown): mode is Lens => mode === 'rookie' || mode === 'scout' || mode === 'player_iq';

/**
 * @param seasons   finished seasons, most recent first (history order)
 * @param current   the lens the player is in now
 * @param played    how many seasons the player has finished in total
 * @param snoozeUntil  `played` must reach this before it speaks again
 */
export function suggestLens(
  seasons: readonly LensSeason[],
  current: Lens,
  played: number,
  snoozeUntil = 0,
): LensSuggestion | null {
  if (played < snoozeUntil) return null;
  const recent = seasons.filter((s) => s.mode === current && !s.assisted).slice(0, LENS_WINDOW);
  if (recent.length < LENS_MIN_SEASONS) return null;
  const average = recent.reduce((sum, s) => sum + s.wins, 0) / recent.length;

  // The season just played has to agree with the trend, roughly: "Try GM
  // Mode?" straight after a 1-16, because the four before it were good, reads
  // as the game not watching. Within three wins of the bar is agreement.
  const latest = recent[0]!.wins;
  const up = LENS_UP[current];
  if (up && average >= up.atLeast && latest >= up.atLeast - 3) {
    return { from: current, to: up.to, direction: 'up', averageWins: Math.round(average) };
  }
  const down = LENS_DOWN[current];
  if (down && average <= down.atMost && latest <= down.atMost + 3) {
    return { from: current, to: down.to, direction: 'down', averageWins: Math.round(average) };
  }
  return null;
}
