import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { standing } from './frame-standing';

/**
 * The frame plays for the board, and says only what is true about it.
 *
 * Two rules, one bug each.
 *
 * The first is that `/embed` must open a *ranked* season. It did not, for the
 * whole life of the frame: `start('scout', { ranked: false })`, justified by a
 * comment saying a frame "has no way to sign in and nothing to attach a season
 * to" when `ensureSession()` has always signed in anonymously with no UI. Every
 * season anybody played in the extension was dealt on the device and scored on
 * the device, and could not have reached a leaderboard even in principle --
 * which is exactly what was reported: "none of the stats from an ESPN linked
 * extension account game show up on the leaderboard".
 *
 * The second is that fixing the first does not put a framed season on a public
 * board, and the copy must not say it does. 0011 filters every board on
 * `profiles.is_permanent`, a frame may never show sign-in (clickjacking --
 * `embed.ts`), so a framed player is anonymous and their real, server-scored
 * season is waiting for a sign-in that has to happen somewhere else.
 *
 * A rule with no test is a rule that is already being broken somewhere, and
 * this one had been broken in two places at once.
 */

const APP = process.cwd();

describe('what a frame may claim about a finished season', () => {
  it('never mentions a board for a season the server never dealt', () => {
    const offline = standing({ ranked: false, permanent: null, assisted: false });
    expect(offline).not.toBeNull();
    expect(offline!.offerBoard).toBe(false);
    expect(`${offline!.title} ${offline!.copy}`).not.toMatch(/board|rank(ed|s)?\b/i);
  });

  it('never claims a board for an assisted season, however it was dealt', () => {
    for (const permanent of [true, false, null]) {
      const line = standing({ ranked: true, permanent, assisted: true });
      expect(line!.offerBoard, `permanent=${permanent}`).toBe(false);
      expect(line!.title).toMatch(/not counted/i);
    }
  });

  it('says nothing at all until the account has answered', () => {
    // The window in which guessing is the bug: guess "on the board" and an
    // anonymous player is told a thing that is false, guess "sign in" and a
    // player who already has is told to do it again.
    expect(standing({ ranked: true, permanent: null, assisted: false })).toBeNull();
  });

  it('does not tell an anonymous player their season is on the board', () => {
    const line = standing({ ranked: true, permanent: false, assisted: false })!;
    expect(line.title).not.toMatch(/on the (scout )?board/i);
    // It still has to say the season is real, and what turns it into a ranking.
    expect(line.copy).toMatch(/sign in/i);
    // And the board is still worth offering: you may look at a board you are
    // not on, and that is the whole reason to want to be.
    expect(line.offerBoard).toBe(true);
  });

  it('tells a signed-in player plainly, because for them it is true', () => {
    const line = standing({ ranked: true, permanent: true, assisted: false })!;
    expect(line.title).toMatch(/on the .*board/i);
    expect(line.copy).not.toMatch(/sign in/i);
    expect(line.offerBoard).toBe(true);
  });
});

describe('the frame itself', () => {
  const embed = readFileSync(join(APP, 'app', 'embed.tsx'), 'utf8');

  it('starts a ranked season', () => {
    // The literal regression. `useStartGame` defaults `ranked` to true, so the
    // only way back into this bug is to turn it off again here.
    expect(embed).toMatch(/start\('scout'\)/);
    expect(embed).not.toMatch(/ranked:\s*false/);
  });

  it('still has no sign-in on it', () => {
    // Ranked play in a frame must arrive through anonymous sign-in and nothing
    // else. A sign-in control on a surface whose position somebody else
    // controls is the clickjacking target `embed.ts` exists to avoid, and
    // "we needed an account for the board" is exactly the reasoning that would
    // put one here.
    expect(embed).not.toMatch(/signIn(WithOAuth|WithPassword)|ProviderButton|AccountPanel/);
  });
});
