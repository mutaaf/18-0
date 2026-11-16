import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGameStore, drawLocalRespin } from '@/state/game';
import type { EraKey, SpinResult } from '@17-0/domain';
import { RESPINS_PER_SEASON } from '@17-0/respins/client';
import { track } from '@/features/telemetry';
import { rankedRespin, spendLocalRespin, useRespinBalance } from './server';

import { purchases } from './store';
export { purchases };
export type { BuyOutcome, PackOffer } from './store';
export { refreshRespinBalance, useRespinBalance } from './server';

export type RespinOutcome =
  | { ok: true; spin: SpinResult; balance: number }
  | { ok: false; kind: 'no_balance' }
  | { ok: false; kind: 'offline' | 'refused'; message: string };

/**
 * Spend one respin on the spin that just landed (docs/respins.md).
 *
 * Ranked: the server checks everything, draws the replacement with the wheel a
 * normal spin uses, debits the ledger and stamps the season, in one
 * transaction -- this only records what it answered.
 *
 * Casual: the server debits (the balance is the server's) and the device draws,
 * with the same rule: uniform over every open franchise-era except the one
 * being replaced. Drawn *before* paying, so a wheel with nowhere else to land
 * never charges anybody.
 */
export async function spendRespin(): Promise<RespinOutcome> {
  const game = useGameStore.getState();
  const current = game.spins[game.spins.length - 1];
  if (!current || game.status !== 'spun') {
    return { ok: false, kind: 'refused', message: 'Spin first.' };
  }
  if (game.respinsUsed >= RESPINS_PER_SEASON) {
    return { ok: false, kind: 'refused', message: 'This season has already used its respin.' };
  }
  const known = useRespinBalance.getState().balance;
  if (known === 0) return { ok: false, kind: 'no_balance' };

  if (game.ranked && game.serverSessionId) {
    const result = await rankedRespin(game.serverSessionId);
    if (!result.ok) {
      if (result.kind === 'refused' && result.reason === 'no_respins') {
        useRespinBalance.getState().set(0);
        return { ok: false, kind: 'no_balance' };
      }
      return { ok: false, kind: result.kind, message: result.message };
    }
    const spin: SpinResult = {
      sequence: result.value.spin.sequence,
      franchiseId: result.value.spin.franchiseId,
      era: result.value.spin.era as EraKey,
    };
    useGameStore.getState().applyRespin(spin);
    track('respin_spent', { ranked: true, open: result.value.drawnFrom });
    return { ok: true, spin, balance: result.value.balance };
  }

  const drawn = drawLocalRespin(game);
  if (!drawn) {
    return { ok: false, kind: 'refused', message: 'No other franchise-era can fill your open slots. Nothing was charged.' };
  }
  const paid = await spendLocalRespin(String(game.startedAt ?? Date.now()), current.sequence);
  if (!paid.ok) {
    if (paid.kind === 'refused' && paid.reason === 'no_respins') {
      useRespinBalance.getState().set(0);
      return { ok: false, kind: 'no_balance' };
    }
    return { ok: false, kind: paid.kind, message: paid.message };
  }
  // The season could have moved on while the server answered -- a pick made in
  // another tap. Only the spin that was paid for is replaced.
  useGameStore.getState().applyRespin(drawn);
  track('respin_spent', { ranked: false });
  return { ok: true, spin: drawn, balance: paid.value };
}

const STORE_USED = '18-0.respins.store-used';

/**
 * Listen for App Store transactions from launch, so a purchase whose answer
 * was lost -- a crash, a dead network -- is redeemed on the next start rather
 * than never. Only on iOS, and only once the store could have been used: with
 * the flag on, or on a device that has bought before (the flag may have been
 * turned off with a transaction still unfinished).
 */
export async function startRespinStore(flagOn: boolean): Promise<void> {
  if (!purchases.canSell) return;
  let used = false;
  try {
    used = (await AsyncStorage.getItem(STORE_USED)) === '1';
  } catch {
    used = false;
  }
  if (flagOn || used) purchases.start();
}

/** Remember that this device has opened a purchase, for `startRespinStore`. */
export function noteStoreUsed(): void {
  AsyncStorage.setItem(STORE_USED, '1').catch(() => {});
}
