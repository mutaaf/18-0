import { useCallback, useEffect, useRef, useState } from 'react';
import { isTV } from './platform';

/** How long a claim is given to land before it is made again. */
const RETRY_MS = 250;
const ATTEMPTS = 4;

/** Spread over the control that should take focus. */
export interface TVInitialFocus {
  hasTVPreferredFocus: boolean;
  onFocus: () => void;
}

/**
 * Focus on one control every time a screen is shown, on a TV. Spread the
 * result over that control: `hasTVPreferredFocus` and `onFocus`.
 *
 * `hasTVPreferredFocus` alone is not enough for a screen that stays mounted or
 * that arrives through a transition:
 *
 * - it claims on mount, or when it goes false to true, and never again -- a
 *   hidden tab stays mounted, so a constant `true` holds for the first visit
 *   only. It follows `focused` instead;
 * - a claim made while the screen is still on its way in is accepted and then
 *   ignored, because UIKit will not focus what it cannot see. Opening Account
 *   from the corner disc landed on the side rail about one time in two: the
 *   claim was recorded, the page was not up yet, and focus fell to the top of
 *   the rail. So a claim that has not produced an `onFocus` is withdrawn and
 *   made again, a few times, until it lands.
 *
 * Everywhere but a TV it returns `false` and a no-op, and changes nothing.
 */
export function useTVInitialFocus(focused: boolean): TVInitialFocus {
  const [claim, setClaim] = useState(false);
  const landed = useRef(false);

  useEffect(() => {
    if (!isTV) return;
    landed.current = false;
    if (!focused) {
      setClaim(false);
      return;
    }
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryClaim = () => {
      if (landed.current || attempt >= ATTEMPTS) return;
      attempt += 1;
      // Off, then on: the native view claims focus on the change to true.
      setClaim(false);
      timer = setTimeout(() => {
        setClaim(true);
        timer = setTimeout(tryClaim, RETRY_MS);
      }, 0);
    };
    tryClaim();
    return () => clearTimeout(timer);
  }, [focused]);

  const onFocus = useCallback(() => {
    landed.current = true;
  }, []);

  return { hasTVPreferredFocus: isTV && claim, onFocus };
}
