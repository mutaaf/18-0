/**
 * Buying respins on iOS: StoreKit 2 through expo-iap, verified by our server.
 *
 * The order is the whole design:
 *
 *   1. StoreKit sells the pack. The purchase carries `appAccountToken`, set to
 *      the account id the player is signed in as, so the server can refuse a
 *      transaction lifted from somebody else's device.
 *   2. The transaction's JWS goes to `redeem-purchase`, which verifies Apple's
 *      signature against Apple's root and grants once per transaction id.
 *   3. Only then is the transaction finished. A crash, a dead network or a
 *      server error between 1 and 3 leaves it in StoreKit's queue, and StoreKit
 *      replays it on the next launch -- `start()` listens for that -- so the
 *      player is never charged for respins they do not receive.
 *
 * `expo-iap` is imported lazily, on first use: the module costs a StoreKit
 * connection at start-up, which a player who never opens the sheet should not
 * pay for. (The web and Android never load this file -- see `store.ts`.)
 */
import { RESPIN_PACKS, RESPIN_PRODUCT_IDS, packFor } from '@17-0/respins/client';
import { currentUser, ensureSession } from '@/services/supabase';
import { redeemPurchase, refreshRespinBalance } from './server';
import type { BuyOutcome, PackOffer, PurchaseApi } from './store-types';

export type { BuyOutcome, PackOffer, PurchaseApi } from './store-types';

type Iap = typeof import('expo-iap');
type Purchase = import('expo-iap').Purchase;

let iap: Promise<Iap | null> | null = null;
let connected: Promise<boolean> | null = null;
let listening = false;

/** Resolvers for a `buy()` that is waiting on StoreKit's answer, by product. */
const waiting = new Map<string, (outcome: BuyOutcome) => void>();

function load(): Promise<Iap | null> {
  iap ??= import('expo-iap').catch(() => null);
  return iap;
}

async function connect(): Promise<Iap | null> {
  const module = await load();
  if (!module) return null;
  connected ??= module.initConnection().catch(() => {
    connected = null;
    return false;
  });
  return (await connected) ? module : null;
}

/**
 * One transaction, end to end: redeem, then finish. Every path that sees a
 * respin transaction comes through here -- a fresh purchase, StoreKit's replay
 * at launch, and the sweep of anything still unfinished.
 */
async function settle(module: Iap, purchase: Purchase): Promise<BuyOutcome | null> {
  if (!RESPIN_PRODUCT_IDS.includes(purchase.productId)) return null;
  if (purchase.purchaseState === 'pending') {
    return { kind: 'pending', message: 'Waiting for the purchase to be approved. Respins arrive when it is.' };
  }
  const jws = purchase.purchaseToken;
  if (!jws) return { kind: 'failed', message: 'The App Store did not hand over that purchase. It will be retried.' };

  const redeemed = await redeemPurchase(jws);
  if (redeemed.ok || redeemed.final) {
    // Finished only now. Before the server has answered, finishing would be
    // telling Apple the player has what they paid for when they may not.
    await module.finishTransaction({ purchase, isConsumable: true }).catch(() => {});
  }
  if (redeemed.ok) {
    const pack = packFor(purchase.productId);
    return { kind: 'granted', respins: redeemed.respins || (pack?.respins ?? 0), balance: redeemed.balance };
  }
  if (redeemed.final) {
    return { kind: 'failed', message: 'That purchase could not be used for respins. Contact support from the account screen.' };
  }
  return {
    kind: 'failed',
    message: 'Paid, but the server has not confirmed it yet. Your respins arrive the next time the app can reach it.',
  };
}

function listen(module: Iap) {
  if (listening) return;
  listening = true;
  module.purchaseUpdatedListener((purchase) => {
    void settle(module, purchase).then((outcome) => {
      if (!outcome) return;
      const resolve = waiting.get(purchase.productId);
      waiting.delete(purchase.productId);
      resolve?.(outcome);
    });
  });
  module.purchaseErrorListener((error) => {
    const cancelled = module.isUserCancelledError(error);
    const productId = (error as { productId?: string | null }).productId ?? null;
    // An error that names no product belongs to whichever buy is waiting;
    // only one sheet is ever open.
    const keys = productId ? [productId] : [...waiting.keys()];
    for (const key of keys) {
      const resolve = waiting.get(key);
      waiting.delete(key);
      resolve?.(cancelled ? { kind: 'cancelled' } : { kind: 'failed', message: 'The App Store could not complete that purchase.' });
    }
  });
}

export const purchases: PurchaseApi = {
  canSell: true,

  async offers(): Promise<PackOffer[] | null> {
    const module = await connect();
    if (!module) return null;
    try {
      const products = (await module.fetchProducts({ skus: [...RESPIN_PRODUCT_IDS], type: 'in-app' })) ?? [];
      const price = new Map(products.map((p) => [p.id, p.displayPrice]));
      const offers = RESPIN_PACKS.flatMap((pack) => {
        const shown = price.get(pack.productId);
        // A pack StoreKit did not return is a pack that cannot be bought
        // here -- not cleared yet, or not in this storefront. It is left out
        // rather than shown with a price the App Store never agreed to.
        return shown ? [{ productId: pack.productId, respins: pack.respins, price: shown }] : [];
      });
      return offers.length > 0 ? offers : null;
    } catch {
      return null;
    }
  },

  async buy(productId: string): Promise<BuyOutcome> {
    if (!packFor(productId)) return { kind: 'failed', message: 'That pack is not for sale.' };
    const module = await connect();
    if (!module) return { kind: 'failed', message: 'Could not reach the App Store.' };
    listen(module);
    // The balance is held on an account. A player who has only ever played
    // offline gets the same anonymous one a ranked season would make.
    if (!(await ensureSession())) return { kind: 'failed', message: 'Buying respins needs a connection.' };
    const me = await currentUser();
    if (!me) return { kind: 'failed', message: 'Buying respins needs a connection.' };

    const answer = new Promise<BuyOutcome>((resolve) => waiting.set(productId, resolve));
    try {
      await module.requestPurchase({
        request: { apple: { sku: productId, appAccountToken: me.id } },
        type: 'in-app',
      });
    } catch (error) {
      waiting.delete(productId);
      return module.isUserCancelledError(error)
        ? { kind: 'cancelled' }
        : { kind: 'failed', message: 'The App Store could not complete that purchase.' };
    }
    return answer;
  },

  start() {
    void (async () => {
      const module = await connect();
      if (!module) return;
      listen(module);
      // StoreKit replays unfinished transactions to the listener at launch;
      // this sweep covers a listener attached after that replay happened.
      try {
        const held = await module.getAvailablePurchases({ onlyIncludeActiveItemsIOS: false });
        for (const purchase of held ?? []) await settle(module, purchase);
      } catch {
        // Nothing to recover is the usual answer, and an error here is retried next launch.
      }
      await refreshRespinBalance();
    })();
  },
};
