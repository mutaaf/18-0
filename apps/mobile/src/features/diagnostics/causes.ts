/**
 * Why a ranked season stopped being ranked, as a category rather than a sentence.
 *
 * The game tells the player in prose (`ranked.ts`, `play.tsx`), and the prose is
 * not sent: one of those sentences quotes the server's exact rating and the
 * client's, and ratings only ever leave the device as bands. A category is also
 * what a dashboard can count. An unrecognised sentence is `other`, which is a
 * prompt to add it here rather than a reason to send the text.
 *
 * Pure, so `errors.test.ts` can pin every sentence the game currently says.
 */
export type DowngradeCause =
  | 'timeout'
  | 'offline'
  | 'session'
  | 'version_mismatch'
  | 'score_disagreement'
  | 'gameday_closed'
  | 'challenge_closed'
  | 'refused'
  /** The device and the server stopped agreeing about the season (`ranked-rules.ts` DIVERGED_NOTE): a move refused for a reason only a disagreement explains. */
  | 'diverged'
  /** The app closed before the ranked game finished opening, found on restore (`state/restore.ts`). */
  | 'interrupted'
  /** A saved pick is no longer in the dataset and was dropped on restore (`state/restore.ts`). */
  | 'picks_dropped'
  | 'other';

const RULES: readonly [RegExp, DowngradeCause][] = [
  [/stopped agreeing about this season/i, 'diverged'],
  [/closed before the ranked game finished opening/i, 'interrupted'],
  [/no longer in the game and was taken off your roster/i, 'picks_dropped'],
  [/did not answer in time/i, 'timeout'],
  [/scoring with model/i, 'version_mismatch'],
  [/server scored this/i, 'score_disagreement'],
  [/gameday has closed|open a gameday game/i, 'gameday_closed'],
  [/challenge is no longer open/i, 'challenge_closed'],
  [/could not (start a session|open a ranked game)|ranked play could not start/i, 'session'],
  [/could not reach the server|needs a connection|not configured/i, 'offline'],
  [/server refused|too many requests|cannot play there|already (on your roster|filled|finished|full)|not part of this spin|spin before picking|could not record|not allowed|take a player|no franchise-era/i, 'refused'],
];

export function downgradeCause(note: string): DowngradeCause {
  for (const [pattern, cause] of RULES) if (pattern.test(note)) return cause;
  return 'other';
}
