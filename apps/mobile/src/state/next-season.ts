/**
 * What a generic Play button starts.
 *
 * The owner's rule: "clicking any play button should lead to the last game
 * type to be started". Before this there were five answers on five screens --
 * the front page played the store's current `mode`, Games and the embed always
 * played Scout, the result's Build Another played the season just finished, and
 * the play screen, opened with nothing in progress, played whatever `mode` was
 * left over. A challenge (always GM Mode) or a gameday therefore quietly
 * changed what the front page's Play did next, and Games ignored the ranked
 * switch altogether.
 *
 * The rules, all of them here and tested in `next-season.test.ts`:
 *
 * 1. **Every generic way in** -- Play, Build Another, Quick play, an empty
 *    state's "Play" -- starts `lastMode` with `preferRanked`.
 * 2. **A button that names a mode starts that mode** (a lens card, a lens
 *    nudge), and that start becomes the new `lastMode`.
 * 3. **Gameday and challenges never become `lastMode`.** Both are dated or
 *    one-off: a gameday's wheel exists only inside its window, and a challenge
 *    is somebody else's question with its own session. A Play that resolved to
 *    either would, the next morning, start a mode that is closed, or answer a
 *    challenge nobody sent. So they leave the last ordinary mode as it was, and
 *    Play after a gameday or a challenge goes back to the lens the player chose.
 * 4. **No history is Scout**, the ranked lens the front page has always led
 *    with (`state/game.ts`).
 *
 * Pure -- no React Native -- so the rules are testable and `restore.ts` can
 * validate the stored value with the same list.
 */

export type GameMode = 'rookie' | 'scout' | 'player_iq' | 'gameday';

/** A mode a generic Play button may resolve to: every lens, never a dated board. */
export type OrdinaryMode = Exclude<GameMode, 'gameday'>;

export const ORDINARY_MODES: readonly OrdinaryMode[] = ['scout', 'player_iq', 'rookie'];

/** What Play starts on a device that has never started a season. */
export const DEFAULT_MODE: OrdinaryMode = 'scout';

/**
 * What each mode is called on screen.
 *
 * The stored key stays `player_iq` while the label is GM Mode. The key is
 * written into every ranked row on the server, into the mode check on
 * game_sessions, and into the local history on every device that has already
 * played -- renaming it would invalidate all three to change a word that only
 * ever appears here.
 */
export const MODE_LABEL: Record<GameMode, string> = {
  rookie: 'Rookie',
  scout: 'Scout',
  player_iq: 'GM Mode',
  gameday: 'Gameday',
};

export const isOrdinaryMode = (mode: unknown): mode is OrdinaryMode =>
  typeof mode === 'string' && (ORDINARY_MODES as readonly string[]).includes(mode);

/**
 * How a season was started. `ordinary` is every lens, from any button; the
 * other two are the one-off ways in (rule 3).
 */
export type StartKind = 'ordinary' | 'gameday' | 'challenge';

/** `lastMode` after a season is started. */
export function lastModeAfter(previous: OrdinaryMode, started: GameMode, kind: StartKind = 'ordinary'): OrdinaryMode {
  if (kind !== 'ordinary') return previous;
  return isOrdinaryMode(started) ? started : previous;
}

/** What the next generic Play starts. */
export function nextSeason(state: { lastMode: OrdinaryMode; preferRanked: boolean }): { mode: OrdinaryMode; ranked: boolean } {
  return { mode: isOrdinaryMode(state.lastMode) ? state.lastMode : DEFAULT_MODE, ranked: state.preferRanked };
}

/**
 * The label on a generic Play button, so the jump is never a surprise:
 * "Play · Scout". `verb` is the button's own word ("Build another").
 */
export function playLabel(mode: OrdinaryMode, verb = 'Play'): string {
  return `${verb} · ${MODE_LABEL[mode]}`;
}

/**
 * The stored `lastMode`, validated at launch.
 *
 * A store written before `lastMode` existed has only `mode`, which was what
 * the front page's Play started -- so that is the honest starting point, unless
 * it was a gameday (rule 3). Anything else is the default.
 */
export function restoreLastMode(raw: { lastMode?: unknown; mode?: unknown }): OrdinaryMode {
  if (isOrdinaryMode(raw.lastMode)) return raw.lastMode;
  if (isOrdinaryMode(raw.mode)) return raw.mode;
  return DEFAULT_MODE;
}
