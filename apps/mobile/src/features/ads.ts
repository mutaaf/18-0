import { Platform } from 'react-native';
import { isEmbedded } from './embed';
import {
  AD_APP,
  AD_LOADER,
  AD_SLOTS,
  SLOT_BETWEEN,
  adsAllowed,
  breakDue,
  type BreakState,
} from './ads-policy';

/**
 * Marquee on the web build. See `ads-policy.ts` for where and how often.
 *
 * Every function here resolves, and resolves at once when ads are off or there
 * is no fill -- which is every call until AdSense is approved. A break that has
 * not visibly started within `START_WINDOW_MS` is abandoned: the player is
 * already on their way to the next season and an ad that wakes up late does
 * not get to pull them back.
 */

interface Marquee {
  interstitial(id: string, hooks?: { beforeAd?: () => void; afterAd?: () => void }): Promise<void>;
}

const START_WINDOW_MS = 1500;
const state: BreakState = { seasonsThisVisit: 0, lastBreakAt: null };
let started = false;

export function adsOn(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return false;
  return adsAllowed({ platform: Platform.OS, embedded: isEmbedded(), hostname: window.location.hostname });
}

/** Injects the loader once. Async and cross-origin, so nothing waits for it. */
export function startAds(): void {
  if (started || !adsOn()) return;
  started = true;
  try {
    const script = document.createElement('script');
    script.async = true;
    script.src = AD_LOADER;
    script.setAttribute('data-app', AD_APP);
    script.setAttribute('data-slots', AD_SLOTS);
    document.head.appendChild(script);
  } catch {
    // An ad that cannot load is no ad, never an error.
  }
}

function marquee(): Marquee | null {
  const m = (window as unknown as { marquee?: Partial<Marquee> }).marquee;
  return m && typeof m.interstitial === 'function' ? (m as Marquee) : null;
}

/**
 * The break between two seasons. Call it as the player asks for another one;
 * it returns when the game may go on. Counts the season either way, so the cap
 * sees every one.
 */
export async function betweenSeasons(): Promise<void> {
  const due = adsOn() && breakDue(state, Date.now());
  state.seasonsThisVisit += 1;
  if (!due) return;
  const m = marquee();
  if (!m) return;
  let showing = false;
  try {
    const shown = m.interstitial(SLOT_BETWEEN, {
      beforeAd: () => {
        showing = true;
        state.lastBreakAt = Date.now();
      },
    });
    await Promise.race([
      shown,
      new Promise<void>((resolve) => setTimeout(() => (showing ? shown.then(resolve, resolve) : resolve()), START_WINDOW_MS)),
    ]);
  } catch {
    // Never gate the game on an ad.
  }
}
