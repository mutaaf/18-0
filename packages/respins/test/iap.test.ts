import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDLE_ID, RESPIN_PACKS } from '../src/index.js';

/**
 * What App Store Connect sells and what the server grants are the same packs.
 *
 * `apps/mobile/store/iap.json` is what `scripts/store/iap.mjs` pushes to Apple;
 * RESPIN_PACKS is what `redeem-purchase` grants for. If the two drift, a player
 * pays for twelve and gets three, or buys a product the server refuses.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const IAP = JSON.parse(readFileSync(resolve(HERE, '../../../apps/mobile/store/iap.json'), 'utf8')) as {
  reviewNote: string;
  products: {
    productId: string;
    referenceName: string;
    type: string;
    usd: string;
    respins: number;
    localizations: Record<string, { name: string; description: string }>;
  }[];
};

describe('the store listing of the packs', () => {
  it('lists exactly the packs the server grants, at the same size and price', () => {
    expect(IAP.products.map((p) => [p.productId, p.respins, p.usd, p.referenceName])).toEqual(
      RESPIN_PACKS.map((p) => [p.productId, p.respins, p.usd, p.referenceName]),
    );
  });

  it('sells consumables under this bundle, within Apple’s lengths', () => {
    for (const product of IAP.products) {
      expect(product.type).toBe('CONSUMABLE');
      expect(product.productId.startsWith(`${BUNDLE_ID}.`)).toBe(true);
      const en = product.localizations['en-US'];
      expect(en, `${product.productId} needs an en-US localization`).toBeDefined();
      expect(en!.name.length).toBeLessThanOrEqual(30);
      expect(en!.description.length).toBeLessThanOrEqual(45);
    }
  });

  it('the StoreKit testing file sells the same packs at the same prices', () => {
    const storekit = JSON.parse(readFileSync(resolve(HERE, '../../../apps/mobile/store/Respins.storekit'), 'utf8')) as {
      products: { productID: string; displayPrice: string; type: string }[];
    };
    expect(storekit.products.map((p) => [p.productID, p.displayPrice, p.type])).toEqual(
      RESPIN_PACKS.map((p) => [p.productId, p.usd, 'Consumable']),
    );
  });

  it('names no club, league or player in anything Apple shows', () => {
    const text = JSON.stringify(IAP).toLowerCase();
    for (const word of ['nfl', 'national football league', 'super bowl']) expect(text).not.toContain(word);
  });
});

