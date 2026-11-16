/**
 * Buying respins, everywhere except iOS: nowhere.
 *
 * The web has no payment account and Android is not on Google Play yet, so
 * neither can sell. Both can *spend* a balance the account already holds --
 * that is server-side and platform-blind -- and the sheet says where respins
 * are sold where a buy button would be.
 *
 * `store.ios.ts` is the real one. Metro picks it on iOS by extension, so the
 * StoreKit module is never in the web or Android bundle at all.
 */
import type { PurchaseApi } from './store-types';

export type { BuyOutcome, PackOffer, PurchaseApi } from './store-types';

export const purchases: PurchaseApi = {
  canSell: false,
  async offers() {
    return null;
  },
  async buy() {
    return { kind: 'unavailable', message: 'Respins are sold in the iOS app.' };
  },
  start() {},
};
