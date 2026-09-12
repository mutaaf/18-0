/**
 * What a frame is allowed to say about where a finished season went.
 *
 * Kept free of react-native, like `frame-size.ts` and for the same reason: the
 * rule here is a claim made to a player about a public board, and a claim is
 * worth a test.
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG
 * ---------------------------------------------------------------------------
 *
 * Two separate lies, a week apart, both of the same shape -- a surface telling
 * somebody their season was ranked when nothing in the system had agreed to
 * rank it.
 *
 * The first was the frame itself. `/embed` started every season with
 * `ranked: false`, on the reasoning that "a frame has no way to sign in and
 * nothing to attach a season to". That was never true: `ensureSession()` signs
 * in anonymously with no UI at all, which is how the site has always opened a
 * ranked session for somebody who has never seen a sign-in screen. So a season
 * played in the frame was dealt locally, scored locally, and could not have
 * reached a board even in principle -- while the extension's consent screen
 * offered to link an account so seasons could "rank on a shared leaderboard".
 *
 * The second is the one this file exists to stop happening again. Fixing the
 * first makes the frame's seasons *real* -- server-dealt, server-scored, on a
 * row the server can prove -- and the obvious next sentence to write on the
 * result screen is "your season is on the board". It would be the same lie
 * one step further in, because of 0011:
 *
 *   > An anonymous account is free and unlimited, which makes a leaderboard of
 *   > anonymous accounts a leaderboard of however many attempts somebody was
 *   > willing to make.
 *
 * `leaderboard_scout` filters on `p.is_permanent`, which is false until a real
 * identity is linked. A frame is play-only by design (`embed.ts` explains why
 * sign-in must never appear in a box somebody else positions), so a framed
 * player is anonymous and their season is recorded, provable, transferable --
 * and not on the public board yet.
 *
 * That is not a consolation prize, and the copy below does not treat it as
 * one: 0011 and 0022 both promise the same thing, that signing in later brings
 * every qualifying season already played onto the board at once. The honest
 * sentence is "recorded, and it goes up when you sign in", and the dishonest
 * one is anything shorter.
 */

/**
 * ---------------------------------------------------------------------------
 * WHY NOTHING HERE TAKES A NAME FROM THE HOST PAGE
 * ---------------------------------------------------------------------------
 *
 * The extension can collect two things that look like identity, and neither
 * one can be the name a framed season ranks under.
 *
 * **The hashed ESPN SWID.** It is a SHA-256 of the SWID with a *random
 * per-install salt*, so the same person on a laptop and a phone produces two
 * entirely different values. It is a pseudonym for one browser, not a name for
 * a person, and it must stay that way: deriving the salt from anything shared
 * would turn a privacy-preserving hash into a stable cross-device identifier
 * for a named ESPN account, which is the tracking identifier that design
 * exists to avoid. So it never leaves the device, and nothing a leaderboard
 * reads is derived from it.
 *
 * **A name the player types into the extension's options.** That one is a real
 * name and the player chose it -- and it still cannot decide what a framed
 * season is called, because of the order things happen in. A framed account is
 * anonymous, 0011 keeps anonymous accounts off every board, and the frame may
 * never show sign-in. So a season played here reaches a board only after it is
 * carried onto an account the player signed in to (0022), and *that* account
 * already has its own handle. A name written onto the throwaway account in
 * between is a name no board will ever render.
 *
 * If that ever changes -- if a framed account could rank on its own -- the
 * transport is still the hard part and not the easy one. The frame and the
 * host exchange `postMessage`, a host page may post whatever it likes, and a
 * name arriving that way is a *request* rather than a proof. The only safe
 * shape is to hand it to `claimHandle()` and let the server refuse it:
 * `profiles.handle` is unique, the denylist catches impersonation, and the
 * rename cooldown is enforced in `enforce_handle_policy`. A client that
 * resolved uniqueness itself would be a client deciding who somebody is.
 */

/** What the server, the account and the season between them actually say. */
export interface SeasonStanding {
  /** The server dealt every spin and scored the roster -- there is a row. */
  readonly ranked: boolean;
  /**
   * Whether the account has a linked identity, which is what
   * `profiles.is_permanent` records and every board filters on. `null` while
   * the answer is still in flight: nothing is claimed until it is known, because
   * guessing wrong in either direction is the bug this file is about.
   */
  readonly permanent: boolean | null;
  /** The three-finger spin. Scored, never ranked, on every board since 0001. */
  readonly assisted: boolean;
}

export interface StandingLine {
  readonly title: string;
  readonly copy: string;
  /** Whether it is worth offering the board from here. */
  readonly offerBoard: boolean;
}

/**
 * The line, or null when there is nothing true to say yet.
 *
 * Returning null rather than a placeholder is deliberate: a frame is a few
 * hundred points tall and the alternative to a hedge is silence, not filler.
 */
export function standing(at: SeasonStanding): StandingLine | null {
  if (at.assisted) {
    return {
      title: 'Assisted — not counted',
      copy: 'The three-finger spin sets no records. Play one straight and it counts.',
      offerBoard: false,
    };
  }

  if (!at.ranked) {
    return {
      title: 'Played offline',
      copy: 'The server never dealt these spins, so there is nothing for it to verify. '
        + 'The season still counts here.',
      offerBoard: false,
    };
  }

  if (at.permanent === null) return null;

  if (at.permanent) {
    return {
      title: 'On the Scout board',
      copy: 'The server dealt every spin and scored the roster. Your best season is ranked.',
      offerBoard: true,
    };
  }

  return {
    title: 'Recorded — not ranked yet',
    copy: 'The server dealt every spin and scored this roster, so it is a real season. '
      + 'Sign in at 18-0 and it goes onto the public board, along with every other '
      + 'season you have played.',
    offerBoard: true,
  };
}
