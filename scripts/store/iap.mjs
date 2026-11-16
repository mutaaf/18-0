/**
 * Create or update the two respin packs in App Store Connect.
 *
 *   set -a; . .local/asc.env; set +a
 *   node scripts/store/iap.mjs            # dry run: reads App Store Connect, prints the plan
 *   node scripts/store/iap.mjs --apply    # writes it
 *
 * `apps/mobile/store/iap.json` is the source, the way listing.json is for the
 * listing: product ids, reference names, the en-US display name and
 * description, the USD price and the review note. This makes App Store Connect
 * match it and reports what moved. Running it twice changes nothing the
 * second time.
 *
 * What it does, per product:
 *   1. finds the in-app purchase by product id, or creates it as CONSUMABLE
 *      (the type cannot be changed afterwards -- Apple refuses);
 *   2. sets the reference name and review note;
 *   3. creates or updates the en-US localization;
 *   4. sets the price: the USA price point whose customer price is the USD in
 *      iap.json, as the base territory, which Apple equalises everywhere else;
 *   5. makes it available in every territory, now and new ones.
 *
 * What it never does: submit anything for review. A new in-app purchase goes
 * to review with an app version, and that is the owner's call -- see
 * docs/respins.md, "Getting the packs live". It also does not upload the
 * review screenshot Apple requires before an IAP can be submitted; that is a
 * picture of the purchase sheet, taken on a device, attached in the console.
 *
 * Before any of this works, the Paid Applications agreement, banking and tax
 * forms must be active in App Store Connect (Business). Without them Apple
 * lets the products be created and they never become purchasable.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_ID, asc, ascAll, patch, post } from './asc-client.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = join(REPO, 'apps', 'mobile', 'store', 'iap.json');
const APPLY = process.argv.includes('--apply');

const config = JSON.parse(await readFile(SOURCE, 'utf8'));

// Apple's limits, checked before the first request rather than discovered in a 409.
for (const product of config.products) {
  for (const [locale, l10n] of Object.entries(product.localizations)) {
    if (l10n.name.length > 30) throw new Error(`${product.productId} ${locale} name is over 30 characters`);
    if (l10n.description.length > 45) throw new Error(`${product.productId} ${locale} description is over 45 characters`);
  }
  if (product.referenceName.length > 64) throw new Error(`${product.productId} reference name is over 64 characters`);
}
if (config.reviewNote.length > 4000) throw new Error('reviewNote is over 4000 characters');

const plan = [];
const say = (line) => {
  plan.push(line);
  console.log(line);
};

/** Write, or in a dry run, say what would be written. */
async function write(what, fn) {
  if (!APPLY) {
    say(`  would ${what}`);
    return null;
  }
  const out = await fn();
  say(`  ${what}`);
  return out;
}

const existing = await ascAll(`/v1/apps/${APP_ID}/inAppPurchasesV2?limit=200`);
const territories = await ascAll('/v1/territories?limit=200');

for (const product of config.products) {
  console.log(`\n${product.productId}  (${product.respins} respins, USD ${product.usd})`);
  let iap = existing.find((p) => p.attributes.productId === product.productId) ?? null;

  if (!iap) {
    iap = await write(`create ${product.type} "${product.referenceName}"`, async () =>
      (await asc('/v2/inAppPurchases', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'inAppPurchases',
            attributes: {
              name: product.referenceName,
              productId: product.productId,
              inAppPurchaseType: product.type,
              reviewNote: config.reviewNote,
              familySharable: product.familySharable,
            },
            relationships: { app: { data: { type: 'apps', id: APP_ID } } },
          },
        }),
      })).data,
    );
    if (!iap) {
      say('  would add the en-US localization, the price and availability once it exists');
      continue;
    }
  } else {
    if (iap.attributes.inAppPurchaseType !== product.type) {
      throw new Error(`${product.productId} exists as ${iap.attributes.inAppPurchaseType}, not ${product.type}; Apple cannot change it`);
    }
    say(`  exists (${iap.id}), state ${iap.attributes.state}`);
    const changed = {};
    if (iap.attributes.name !== product.referenceName) changed.name = product.referenceName;
    if ((iap.attributes.reviewNote ?? '') !== config.reviewNote) changed.reviewNote = config.reviewNote;
    if (Object.keys(changed).length > 0) {
      await write(`update ${Object.keys(changed).join(', ')}`, () =>
        patch(`/v2/inAppPurchases/${iap.id}`, 'inAppPurchases', iap.id, changed),
      );
    }
  }

  // Localizations.
  const l10ns = await ascAll(`/v2/inAppPurchases/${iap.id}/inAppPurchaseLocalizations?limit=50`);
  for (const [locale, want] of Object.entries(product.localizations)) {
    const have = l10ns.find((l) => l.attributes.locale === locale);
    if (!have) {
      await write(`add ${locale} "${want.name}" / "${want.description}"`, () =>
        post('/v1/inAppPurchaseLocalizations', {
          type: 'inAppPurchaseLocalizations',
          attributes: { locale, name: want.name, description: want.description },
          relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iap.id } } },
        }),
      );
    } else if (have.attributes.name !== want.name || have.attributes.description !== want.description) {
      await write(`update ${locale} to "${want.name}" / "${want.description}"`, () =>
        patch(`/v1/inAppPurchaseLocalizations/${have.id}`, 'inAppPurchaseLocalizations', have.id, {
          name: want.name,
          description: want.description,
        }),
      );
    }
  }

  // Price: the USA point at exactly this customer price, as the base.
  const points = await ascAll(`/v2/inAppPurchases/${iap.id}/pricePoints?filter[territory]=USA&limit=200`);
  const point = points.find((p) => p.attributes.customerPrice === product.usd);
  if (!point) throw new Error(`no USA price point at ${product.usd} for ${product.productId}`);
  let current = null;
  try {
    const schedule = await asc(`/v2/inAppPurchases/${iap.id}/iapPriceSchedule?include=manualPrices,baseTerritory`);
    const prices = (schedule.included ?? []).filter((i) => i.type === 'inAppPurchasePrices');
    current = prices.map((p) => p.relationships?.inAppPurchasePricePoint?.data?.id).find(Boolean) ?? null;
  } catch {
    current = null; // no schedule yet
  }
  if (current !== point.id) {
    await write(`set the price to USD ${product.usd} (price point ${point.id}), USA as base`, () =>
      asc('/v1/inAppPurchasePriceSchedules', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'inAppPurchasePriceSchedules',
            relationships: {
              inAppPurchase: { data: { type: 'inAppPurchases', id: iap.id } },
              baseTerritory: { data: { type: 'territories', id: 'USA' } },
              manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${price}' }] },
            },
          },
          included: [
            {
              type: 'inAppPurchasePrices',
              id: '${price}',
              attributes: { startDate: null },
              relationships: { inAppPurchasePricePoint: { data: { type: 'inAppPurchasePricePoints', id: point.id } } },
            },
          ],
        }),
      }),
    );
  } else {
    say(`  price already USD ${product.usd}`);
  }

  // Availability: everywhere, including territories Apple adds later.
  let available = null;
  try {
    available = await asc(`/v2/inAppPurchases/${iap.id}/inAppPurchaseAvailability`);
  } catch {
    available = null;
  }
  if (!available?.data) {
    await write(`make it available in all ${territories.length} territories`, () =>
      post('/v1/inAppPurchaseAvailabilities', {
        type: 'inAppPurchaseAvailabilities',
        attributes: { availableInNewTerritories: true },
        relationships: {
          inAppPurchase: { data: { type: 'inAppPurchases', id: iap.id } },
          availableTerritories: { data: territories.map((t) => ({ type: 'territories', id: t.id })) },
        },
      }),
    );
  } else {
    say('  availability already set');
  }
}

console.log(
  APPLY
    ? '\nDone. Nothing was submitted for review. Attach a review screenshot of the purchase sheet to each product in App Store Connect, then submit them with the next app version.'
    : '\nDry run: nothing was written. Re-run with --apply to make these changes.',
);
