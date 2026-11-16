import { useGameStore } from '@/state/game';
import { downgradeCause } from './causes';
import { reportHealth } from './report';

/**
 * The key path, measured where it already runs.
 *
 * Two signals, both attached from outside the code they measure so the play
 * screen and the game store -- the busiest files in the app -- carry no
 * instrumentation of their own:
 *
 * - `server_call`, from the one function every Edge Function call goes
 *   through (`ranked.ts`'s `invoke`). Spin latency, select failures and
 *   completion failures are all this event filtered by `fn`.
 * - `season_downgraded`, from a store subscription. A ranked season can fall
 *   back to unranked in four places (opening, a spin, a pick, the reveal) and
 *   only the first was ever reported; watching the store catches all four,
 *   including any added later.
 */

export type CallOutcome = 'ok' | 'refused' | 'offline';

/**
 * Over this, a call is slow enough to be worth finding in the server's logs,
 * so its request id is sent with it. The play screen gives a spin eight
 * seconds before giving up on it; a spin taking three is already a spin the
 * player watched.
 */
const SLOW_MS = 3000;

export function noteServerCall(
  fn: string,
  outcome: CallOutcome,
  ms: number,
  detail: { reason?: string; status?: number; errorClass?: string; requestId?: string } = {},
): void {
  const worthFinding = outcome !== 'ok' || ms > SLOW_MS;
  reportHealth('server_call', {
    fn,
    outcome,
    ms: Math.round(ms),
    slow: ms > SLOW_MS,
    ...(detail.reason ? { reason: detail.reason.slice(0, 48) } : {}),
    ...(detail.status ? { status: detail.status } : {}),
    ...(detail.errorClass ? { error_class: detail.errorClass.slice(0, 48) } : {}),
    // The id the Edge Function logs and the audit trail stores. Sent only when
    // somebody will want to look the request up, which is the only reason to
    // send it at all.
    ...(worthFinding && detail.requestId ? { request_id: detail.requestId } : {}),
  });
}

let watching = false;

export function watchDowngrades(): void {
  if (watching) return;
  watching = true;
  useGameStore.subscribe((state, previous) => {
    if (!previous.ranked || state.ranked || !state.serverNote) return;
    reportHealth('season_downgraded', {
      cause: downgradeCause(state.serverNote),
      filled: state.selections.length,
      mode: state.mode,
    });
  });
}
