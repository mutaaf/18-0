/**
 * The Siri Remote, read as Gut Check calls.
 *
 * The same four calls the touch screen makes with a finger and the web makes
 * with arrow keys: right is fair, left is off, and after "off" up says the
 * rating deserves more and down says less. A swipe across the remote's touch
 * surface and a click on the edge of its clickpad both count -- tvOS reports
 * them as `swipeRight` and `right` -- because people do both and neither is
 * wrong. A click in the middle is `select`, which goes to the focused button
 * ("Don't know") rather than through here.
 *
 * Pure, so the mapping is tested without a television (remote-calls.test.ts).
 */
export type RemoteAction = 'fair' | 'off' | 'too_low' | 'too_high';

const DIRECTION: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  left: 'left',
  swipeLeft: 'left',
  right: 'right',
  swipeRight: 'right',
  up: 'up',
  swipeUp: 'up',
  down: 'down',
  swipeDown: 'down',
};

/**
 * @param keyAction React Native's `eventKeyAction`: 0 when a press begins, 1
 *   when it ends, absent for a swipe. A click is answered once, on release.
 */
export function remoteAction(
  eventType: string,
  keyAction: number | undefined,
  phase: 'judge' | 'which',
): RemoteAction | null {
  if (keyAction === 0) return null;
  const direction = DIRECTION[eventType];
  if (!direction) return null;
  if (phase === 'judge') {
    if (direction === 'right') return 'fair';
    if (direction === 'left') return 'off';
    return null;
  }
  // Asking which way: up is "deserves more" (the rating is too low), down is
  // "deserves less". Right still means "fair after all", as its button says.
  if (direction === 'up') return 'too_low';
  if (direction === 'down') return 'too_high';
  if (direction === 'right') return 'fair';
  return null;
}
