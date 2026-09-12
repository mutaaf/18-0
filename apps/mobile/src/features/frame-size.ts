/**
 * Which of the frame's own messages the host is allowed to hear.
 *
 * Pulled out of `embed.ts` and kept free of react-native so it can be tested in
 * node, because the rule below is the whole of a bug that shipped and that
 * nothing else could have caught: a screen the player had already left got the
 * last word about how tall the frame should be.
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG
 * ---------------------------------------------------------------------------
 *
 * The entry card measures itself and tells the host, so a board of two managers
 * does not get a frame sized for ten. Pressing "Play a season" moves to the
 * game, which announces itself as `play` and is given six hundred points.
 *
 * But the screen being torn down gets one more layout pass on its way out, and
 * that pass ran *after* the game had announced itself. The entry card's two
 * hundred and thirty two points landed on a frame that had just become the
 * game, and the roster opened into a box the height of a play button with the
 * spin card cut in half by the pinned bar. Nothing threw, nothing was undefined
 * and no type was wrong: the last message simply came from the wrong screen.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 *
 * Naming a screen is a *handover* and is always sent -- it is how the host
 * learns where the player is, and it is sent before that screen has measured
 * anything. A height is a *measurement*, and a measurement is only ever about
 * the screen that is currently showing. A measurement from any other screen is
 * a screen talking about a frame it no longer occupies, and is dropped.
 */

export type EmbedScreen = 'entry' | 'play' | 'result' | 'board';

export interface FrameTalk {
  /** The screen the host has been told the player is on. */
  readonly showing: EmbedScreen | null;
}

export const NOTHING_SHOWN: FrameTalk = { showing: null };

export interface FrameDecision {
  /** Whether this message should reach the host at all. */
  readonly send: boolean;
  /** The state to carry forward. */
  readonly next: FrameTalk;
}

/**
 * @param at      what the host has been told so far.
 * @param screen  the screen this message is about.
 * @param height  its measured height, if this is a measurement rather than a
 *                handover.
 */
export function decide(at: FrameTalk, screen: EmbedScreen, height?: number): FrameDecision {
  // A handover. Always sent, and it is what makes later measurements from this
  // screen -- and only this screen -- admissible.
  if (height === undefined) return { send: true, next: { showing: screen } };

  // A measurement from a screen that is no longer showing. This is the one the
  // bug was: it is dropped, and it does not become the current screen either,
  // because a screen on its way out must not take the frame back.
  if (screen !== at.showing) return { send: false, next: at };

  return { send: true, next: at };
}
