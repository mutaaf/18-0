import { Platform } from 'react-native';
import { create } from 'zustand';
import { currentUser, ensureSession, supabase } from '@/services/supabase';
import { invoke, type RankedResult } from '@/features/ranked';
import { uuid } from '@/features/uuid';
import { noteServerCall } from '@/features/diagnostics/health';

/**
 * The respin balance, and the three ways the app asks the server about it.
 *
 * The balance lives on the server, as a sum over an append-only ledger
 * (0026), because a ranked season spends it and invariant 2 says the client is
 * never the source of anything a leaderboard reads. So this file never adds or
 * subtracts on its own: every number it shows is one the server just said.
 */

interface BalanceState {
  /** null until the server has answered, or when it cannot be reached. */
  balance: number | null;
  set: (balance: number | null) => void;
}

export const useRespinBalance = create<BalanceState>()((set) => ({
  balance: null,
  set: (balance) => set({ balance }),
}));

/**
 * Ask the server for the balance. Null when there is no backend, no network,
 * or no account yet -- which the control reads as "needs a connection" rather
 * than as zero, because zero would offer to sell somebody respins they own.
 */
export async function refreshRespinBalance(): Promise<number | null> {
  if (!supabase) return null;
  const me = await currentUser();
  if (!me) {
    // No account has ever been made on this device, so nothing was ever bought
    // on it. Zero is the truth, and saying so needs no sign-in.
    useRespinBalance.getState().set(0);
    return 0;
  }
  const started = Date.now();
  try {
    const { data, error } = await supabase.rpc('my_respins');
    noteServerCall('my-respins', error ? 'refused' : 'ok', Date.now() - started, {
      ...(error ? { reason: error.code ?? 'rpc_failed' } : {}),
    });
    if (error) return null;
    const balance = Math.max(0, Number(data ?? 0));
    useRespinBalance.getState().set(balance);
    return balance;
  } catch {
    noteServerCall('my-respins', 'offline', Date.now() - started, {});
    return null;
  }
}

export interface RespinDrawn {
  readonly spin: { sequence: number; franchiseId: string; era: string };
  readonly balance: number;
  readonly drawnFrom: number;
}

/** A ranked season's respin: the server checks, draws, debits and records. */
export async function rankedRespin(sessionId: string): Promise<RankedResult<RespinDrawn>> {
  const result = await invoke<RespinDrawn>('respin', { gameSessionId: sessionId });
  if (result.ok) useRespinBalance.getState().set(result.value.balance);
  return result;
}

/**
 * Pay for a casual season's respin. The draw is local -- a casual wheel has
 * always turned on the device -- so this only debits, keyed by the local game
 * and the turn so a retried tap is not a second charge.
 */
export async function spendLocalRespin(gameId: string, sequence: number): Promise<RankedResult<number>> {
  if (!supabase) return { ok: false, kind: 'offline', message: 'Respins need a connection.' };
  const started = Date.now();
  try {
    const { data, error } = await supabase.rpc('spend_local_respin', { p_game: gameId, p_sequence: sequence });
    if (error) {
      noteServerCall('spend-respin', 'refused', Date.now() - started, { reason: error.message });
      const known: Record<string, string> = {
        no_respins: 'You have no respins left.',
        respin_already_used: 'This season has already used its respin.',
      };
      return { ok: false, kind: 'refused', reason: error.message, message: known[error.message] ?? 'The server refused that.' };
    }
    noteServerCall('spend-respin', 'ok', Date.now() - started, {});
    const balance = Math.max(0, Number(data ?? 0));
    useRespinBalance.getState().set(balance);
    return { ok: true, value: balance };
  } catch {
    noteServerCall('spend-respin', 'offline', Date.now() - started, {});
    return { ok: false, kind: 'offline', message: 'Respins need a connection.' };
  }
}

export type RedeemOutcome =
  | { ok: true; balance: number; granted: boolean; respins: number }
  /** `final`: the server will never accept this one, so finish it anyway. */
  | { ok: false; final: boolean; reason: string };

/**
 * Hand a StoreKit 2 transaction to the server, which verifies Apple's
 * signature and grants once per transaction id. The caller finishes the
 * transaction only on `ok` or `final` -- anything else stays in StoreKit's
 * queue and is sent again on the next launch.
 */
export async function redeemPurchase(signedTransaction: string): Promise<RedeemOutcome> {
  if (!supabase) return { ok: false, final: false, reason: 'offline' };
  if (!(await ensureSession())) return { ok: false, final: false, reason: 'offline' };
  const requestId = uuid();
  const started = Date.now();
  try {
    const { data, error } = await supabase.functions.invoke('redeem-purchase', {
      body: { signedTransaction },
      headers: { 'x-client': Platform.OS, 'x-request-id': requestId },
    });
    if (error) {
      const response = (error as { context?: Response }).context;
      let body: { error?: string; final?: boolean } | null = null;
      try {
        body = response && typeof response.json === 'function' ? await response.json() : null;
      } catch {
        body = null;
      }
      noteServerCall('redeem-purchase', body ? 'refused' : 'offline', Date.now() - started, {
        reason: body?.error ?? undefined,
        requestId,
      });
      return { ok: false, final: body?.final === true, reason: body?.error ?? 'offline' };
    }
    noteServerCall('redeem-purchase', 'ok', Date.now() - started, { requestId });
    const value = data as { balance: number; granted: boolean; respins: number };
    useRespinBalance.getState().set(Math.max(0, Number(value.balance ?? 0)));
    return { ok: true, balance: Number(value.balance ?? 0), granted: value.granted === true, respins: Number(value.respins ?? 0) };
  } catch {
    noteServerCall('redeem-purchase', 'offline', Date.now() - started, { requestId });
    return { ok: false, final: false, reason: 'offline' };
  }
}
