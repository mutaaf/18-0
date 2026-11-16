/**
 * The rules of a respin, written once for the app and the server.
 *
 * A respin replaces the spin that just landed, before anything is picked from
 * it: that franchise-era is set aside and a new one is drawn for the same turn.
 * It changes which seven buckets a roster is built from and nothing about how
 * the roster is scored -- which is why none of this lives in `packages/domain`
 * and why spending one never bumps the model `version`.
 *
 * Bundled into the Edge Functions as `supabase/functions/_shared/respins.ts`
 * (`pnpm --filter @17-0/respins build:edge`), for the reason `domain.ts` is: two
 * copies of "how many per season" or "which products exist" that agree today
 * are two copies, and one of them is the one nobody updated.
 */

/**
 * At most this many respins in one season.
 *
 * Also stated in SQL as `public.respins_per_season()` (0026), because the
 * transaction that spends one has to check it under the same lock that
 * debits the balance. `rules.test.ts` reads the migration and fails when the
 * two disagree.
 */
export const RESPINS_PER_SEASON = 1;

/** The App Store bundle the products belong to. */
export const BUNDLE_ID = 'com.eighteenzerodcai.app';

export interface RespinPack {
  /** The App Store product id. Created by `scripts/store/iap.mjs`. */
  readonly productId: string;
  /** How many respins one purchase of it grants. */
  readonly respins: number;
  /** USD, for the store script and for the copy when StoreKit has not answered. */
  readonly usd: string;
  /** App Store Connect's internal name; never shown to a player. */
  readonly referenceName: string;
}

/**
 * The two consumable packs. The order is the order the sheet shows them in.
 *
 * The price shown to a player is always StoreKit's localized string, never
 * `usd`: a storefront in another currency is charged in that currency, and a
 * price the app made up is a price the App Store did not agree to.
 */
export const RESPIN_PACKS: readonly RespinPack[] = [
  {
    productId: `${BUNDLE_ID}.respins.3`,
    respins: 3,
    usd: '0.99',
    referenceName: 'Respins - 3',
  },
  {
    productId: `${BUNDLE_ID}.respins.12`,
    respins: 12,
    usd: '2.99',
    referenceName: 'Respins - 12',
  },
];

export const RESPIN_PRODUCT_IDS: readonly string[] = RESPIN_PACKS.map((p) => p.productId);

export function packFor(productId: string): RespinPack | null {
  return RESPIN_PACKS.find((p) => p.productId === productId) ?? null;
}

/**
 * The ledger's `reference` for each kind of row. The column is UNIQUE, so the
 * reference *is* the idempotency: a retried grant or a retried spend writes a
 * row that already exists and is refused, rather than a second one.
 *
 *   purchase  Apple's transactionId. A transaction is granted once, however
 *             many times the app re-sends it after a crash or a lost answer.
 *   spend     the season and the turn. The same respin cannot be paid for
 *             twice, and `respins_per_season()` bounds how many turns may be.
 *   refund    Apple's transactionId again, under its own prefix.
 */
export const ledgerReference = {
  purchase: (transactionId: string) => `apple:${transactionId}`,
  refund: (transactionId: string) => `apple-refund:${transactionId}`,
  rankedSpend: (sessionId: string, sequence: number) => `spend:${sessionId}:${sequence}`,
  /**
   * A season that never reached the server -- casual, or ranked that fell back
   * offline. Keyed by the device's own game id, which the server cannot verify
   * and does not need to: nothing a casual season does reaches a board, and the
   * key only has to stop one tap being charged twice.
   */
  localSpend: (localGameId: string, sequence: number) => `spend-local:${localGameId}:${sequence}`,
} as const;

/** What the ↻ mark means, in one place, for every screen that explains it. */
export const RESPIN_MARK = '↻';
export const RESPIN_MARK_MEANING =
  'This season used a respin. It still counts on the boards, marked, and never on the perfect-season board.';
