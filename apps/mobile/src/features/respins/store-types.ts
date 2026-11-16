/** One pack as the store will sell it here, with the store's own price. */
export interface PackOffer {
  readonly productId: string;
  readonly respins: number;
  /** StoreKit's localized price, e.g. "$0.99" or "0,99 €". Never made up. */
  readonly price: string;
}

export type BuyOutcome =
  | { kind: 'granted'; respins: number; balance: number }
  | { kind: 'cancelled' }
  /** Ask to Buy, or a card that needs approving: StoreKit will finish it later. */
  | { kind: 'pending'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'unavailable'; message: string };

export interface PurchaseApi {
  /** True only where a purchase can actually be made: the iOS app. */
  readonly canSell: boolean;
  /** The packs with localized prices, or null when the store cannot be reached. */
  offers(): Promise<PackOffer[] | null>;
  buy(productId: string): Promise<BuyOutcome>;
  /**
   * Begin listening for transactions, and re-send any StoreKit is still
   * holding: a purchase whose answer from the server never arrived (a crash,
   * a dead network) is redeemed on the next launch rather than lost.
   */
  start(): void;
}
