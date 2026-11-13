import type { TelemetryEvent } from '@/features/telemetry';

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
    const p = event.props;
    if (event.name === 'play_started') {
      boxoffice()?.track('game_start', { mode: p.mode, ranked: p.ranked });
    } else if (event.name === 'roster_completed') {
      // `record` is "wins-losses"; the portfolio dashboards want the numbers.
      const [wins, losses] = String(p.record ?? '').split('-').map(Number);
      boxoffice()?.track('game_over', {
        wins,
        losses,
        mode: p.mode,
        ending: p.ending,
        rating_band: p.rating,
      });
    }
  } catch {
    // Analytics must never be able to break a game.
  }
}
