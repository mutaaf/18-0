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
  | 'other';

const RULES: readonly [RegExp, DowngradeCause][] = [
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
