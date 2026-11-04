import { APP_HOST } from './links';

/**
 * Where ads may run, and how often a break may interrupt.
 *
 * Pure and react-native free so it is testable under `environment: 'node'`;
 * `ads.ts` is the half that touches the page.
 *
 * The owner decided on 2026-10-30 to monetize the collection through Marquee,
 * the ad server at mutaafaziz.com/ads. Its contract (marquee/AGENTS.md) is that
 * every call resolves, immediately when there is no ad, so nothing here may
 * ever stand between a player and the next spin.
 *
 * - **Web only.** Native builds never load the loader; AdMob is a later phase
 *   and a different SDK.
 * - **Never in a frame.** `/embed` lives inside somebody else's page (the ESPN
 *   watch extension). Putting our ads in their page is not ours to do.
 * - **Only on the two addresses that are the game.** A preview deployment, a
 *   localhost dev server or a copy of `dist/` somewhere else loads nothing, so
 *   the counts Marquee keeps are counts of players.
 */

export const AD_LOADER = 'https://mutaafaziz.com/ads/v1/ads.js';
export const AD_APP = '18-0';
export const AD_PRIVACY_URL = 'https://mutaafaziz.com/ads/privacy/';

/**
 * Every slot, and the moment it belongs to. Each is a pause the player chose:
 * a season that has finished, the front page before one starts, the step
 * between two seasons. None is ever on the play screen, where the reels spin
 * and the picks are made -- `ads-policy.test.ts` reads that screen's source
 * and fails if an ad reaches it.
 */
export const SLOT_RESULTS = 'results';
export const SLOT_HOME = 'home';
export const SLOT_BETWEEN = 'between-seasons';
/** Declared up front so the first config fetch already knows every slot. */
export const AD_SLOTS = `${SLOT_RESULTS}:banner:menu,${SLOT_HOME}:banner:menu,${SLOT_BETWEEN}:interstitial:menu`;

/**
 * The height a banner holds while it loads: the 90 Marquee's integration
 * guide reserves, which is a leaderboard banner and the floor of a responsive
 * one. Less than that and a fill still moves the page.
 */
export const AD_BANNER_RESERVE = 90;

const HOSTS = new Set([APP_HOST, `www.${APP_HOST}`, 'mutaaf.github.io']);

export function adsAllowed(env: { platform: string; embedded: boolean; hostname: string }): boolean {
  return env.platform === 'web' && !env.embedded && HOSTS.has(env.hostname);
}

/**
 * Our own cap on the between-seasons break, on top of Marquee's per-slot one.
 *
 * The first season of a visit is never interrupted -- somebody who came to play
 * one game should never see a break -- and after that at most one break every
 * `BREAK_EVERY_MS`, however fast the seasons go.
 */
export const BREAK_EVERY_MS = 4 * 60 * 1000;

export interface BreakState {
  seasonsThisVisit: number;
  lastBreakAt: number | null;
}

export function breakDue(state: BreakState, now: number): boolean {
  if (state.seasonsThisVisit < 1) return false;
  if (state.lastBreakAt !== null && now - state.lastBreakAt < BREAK_EVERY_MS) return false;
  return true;
}
