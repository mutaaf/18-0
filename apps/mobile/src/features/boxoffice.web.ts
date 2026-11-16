import type { TelemetryEvent } from '@/features/telemetry';
import { clean, translate } from '@/features/boxoffice-queue';

/**
 * The browser build's game events, handed to Box Office.
 *
 * Box Office (mutaafaziz.com/boxoffice) is the loader in `public/index.html`:
 * it captures page views on its own and relays everything to PostHog through
 * mutaafaziz.com. It names events in the portfolio's shared vocabulary
 * (`game_start`, `game_over`) so one dashboard reads every game, which is why
 * this translates a couple of events rather than forwarding the whole stream --
 * the full stream already goes to this game's own PostHog project through
 * `analytics.ts`, and duplicating it into the portfolio project would only
 * spend the free tier twice.
 *
 * Queue-safe: if the async script has not arrived yet, the call is held in
 * `q` and the loader replays it. Nothing here may throw into gameplay.
 */
type BoxOffice = { q?: unknown[][]; track: (name: string, props?: Record<string, unknown>) => void };

function boxoffice(): BoxOffice | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { boxoffice?: BoxOffice };
  w.boxoffice ??= {
    q: [],
    track(...args: unknown[]) {
      this.q!.push(args);
    },
  };
  return w.boxoffice;
}

export function forwardToBoxOffice(event: TelemetryEvent): void {
  try {
    // The same translation the iOS app uses (`boxoffice-queue.ts`); the loader
    // checks nothing, so the vocabulary's own check runs here too.
    const t = translate(event);
    const props = t && clean(t.name, t.props);
    if (t && props) boxoffice()?.track(t.name, props);
  } catch {
    // Analytics must never be able to break a game.
  }
}

/**
 * The browser honours Global Privacy Control and Do Not Track instead of an
 * in-game switch (privacy.html, "Site analytics in the browser version").
 */
export const usageStatsSupported = false;
export async function usageStatsOn(): Promise<boolean> {
  return false;
}
export async function setUsageStats(_on: boolean): Promise<boolean> {
  return false;
}
