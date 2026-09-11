import { Platform } from 'react-native';

/**
 * The game, running inside somebody else's page.
 *
 * The embed exists so the game can sit in a frame -- a row on a watch page, a
 * slot in a dashboard -- and be played there rather than linked to. What it is
 * *not* is the whole app in an iframe, and the difference is a security one
 * rather than a design one.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE SURFACE AND NOT A HEADER CHANGE
 * ---------------------------------------------------------------------------
 *
 * The site sends `X-Frame-Options: SAMEORIGIN`, and the obvious way to get the
 * game into a frame is to stop sending it. That would also put the account
 * screen in a frame -- sign-in, handle claiming, and a button that deletes an
 * account and every season on it -- on a page whose owner controls exactly
 * where the player's cursor lands. Clickjacking is a real attack against
 * precisely that button.
 *
 * So `/embed` is framable and nothing else is, and the surface it offers is
 * play-only: no sign-in, no account, no deletion. A frame can start a season
 * and show what it scored, and that is the whole of it. `vercel.json` scopes
 * the header to this one path and names the origins allowed to hold it.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS READ ONCE
 * ---------------------------------------------------------------------------
 *
 * This is a single-page app: `location.pathname` changes as the player moves
 * between the entry card, the game and the result, so a live read would say
 * "embedded" on the first screen and "not embedded" on the second. What makes a
 * session embedded is how it *arrived*, which is a fact about the page load.
 */

const embedded = (() => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    const { pathname, search } = window.location;
    return pathname.replace(/\/+$/, '').endsWith('/embed') || /(^|[?&])embed=1(&|$)/.test(search);
  } catch {
    return false;
  }
})();

export function isEmbedded(): boolean {
  return embedded;
}

/**
 * Where "done" goes.
 *
 * Closing a game or finishing a season normally returns to the tabs, which in a
 * frame means a dock, a leaderboard and an account button in a box the size of
 * a playing card. Embedded, all of those lead back to the entry card instead.
 */
export function homeRoute(): '/embed' | '/(tabs)' {
  return embedded ? '/embed' : '/(tabs)';
}

/**
 * Tells the host page what the frame is doing.
 *
 * One-way and advisory: the host uses it to size the frame to the screen the
 * player is actually on, because an entry card and a seven-row roster want very
 * different heights and a frame that fits both fits neither. Nothing is read
 * back, and nothing here is trusted -- the message is a courtesy, not a channel.
 *
 * `height` is the screen's own measurement, and the reason it exists is that a
 * name is not a height. A board of two managers and a board of ten are both
 * `board`, and the host's table had one number for them -- which drew a podium
 * of two and then a hundred points of empty navy underneath it. The name stays
 * because the host needs a height *before* the frame has loaded anything; the
 * measurement refines it once there is something real to measure.
 */
export function tellHost(
  screen: 'entry' | 'play' | 'result' | 'board',
  height?: number,
): void {
  if (!embedded || typeof window === 'undefined') return;
  try {
    // '*' rather than an origin: the frame does not know who is holding it, and
    // the payload is the name of a screen. There is nothing here to leak.
    window.parent?.postMessage(
      { source: '18-0', screen, ...(height && height > 0 ? { height: Math.ceil(height) } : null) },
      '*',
    );
  } catch {
    // A sandboxed frame with no parent access. The host gets a fixed height.
  }
}
