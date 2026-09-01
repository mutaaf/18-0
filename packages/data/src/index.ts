import { POSITION_MODELS, type EraKey, type Position, type RatedSeason } from '@18-0/domain';
import raw from '../generated/dataset.json' with { type: 'json' };
import type { Dataset, DatasetCard, DatasetFranchise } from './schema.js';

export * from './schema.js';

/**
 * The bundled historical dataset.
 *
 * NFL history is immutable, so this is computed once at build time and shipped
 * with the app: spins, eligible lists and ratings are all resolved locally with
 * no network at all.
 */
export const DATASET = raw as unknown as Dataset;

const FRANCHISE_BY_ID = new Map(DATASET.franchises.map((f) => [f.id, f]));

/** Cards indexed by franchise-era, then by position — the spin's eligible list. */
const BUCKETS = (() => {
  const map = new Map<string, Map<Position, DatasetCard[]>>();
  for (const card of DATASET.cards) {
    const key = `${card.franchiseId}:${card.era}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = new Map();
      map.set(key, bucket);
    }
    const list = bucket.get(card.position);
    if (list) list.push(card);
    else bucket.set(card.position, [card]);
  }
  for (const bucket of map.values()) {
    for (const list of bucket.values()) list.sort((a, b) => b.rating - a.rating);
  }
  return map;
})();

export const bucketKey = (franchiseId: string, era: EraKey): string => `${franchiseId}:${era}`;

export function franchise(id: string): DatasetFranchise {
  const found = FRANCHISE_BY_ID.get(id);
  if (!found) throw new Error(`Unknown franchise: ${id}`);
  return found;
}

/** Every eligible card for one spin, best first. */
export function eligibleCards(franchiseId: string, era: EraKey): DatasetCard[] {
  const bucket = BUCKETS.get(bucketKey(franchiseId, era));
  if (!bucket) return [];
  return [...bucket.values()].flat().sort((a, b) => b.rating - a.rating);
}

export function eligibleByPosition(franchiseId: string, era: EraKey, position: Position): DatasetCard[] {
  return BUCKETS.get(bucketKey(franchiseId, era))?.get(position) ?? [];
}

/** Adapts a dataset card into the shape the scoring domain expects. */
export function toRatedSeason(card: DatasetCard): RatedSeason {
  return {
    id: card.id,
    entityId: card.entityId,
    entityType: card.position === 'DEF' ? 'defense' : 'player',
    displayName: displayName(card),
    position: card.position,
    franchiseId: card.franchiseId,
    seasonYear: card.year,
    era: card.era,
    rating: card.rating,
    archetypes: card.archetypes,
    ratingModelVersion: DATASET.ratingModelVersion,
  };
}

/** Team defences have no player name, so they are named for the season. */
export function displayName(card: DatasetCard): string {
  if (card.position !== 'DEF') return card.name;
  return `${card.year} ${franchise(card.franchiseId).nick} Defense`;
}

export function cardById(id: string): DatasetCard | undefined {
  return DATASET.cards.find((c) => c.id === id);
}

export interface ComponentBreakdown {
  readonly key: string;
  readonly label: string;
  readonly score: number;
  readonly weight: number;
  readonly metric: string | null;
  readonly z: number | null;
}

/** Rehydrates a card's component scores with their human labels. */
export function componentBreakdown(card: DatasetCard): ComponentBreakdown[] {
  const model = POSITION_MODELS[card.position];
  const labels = new Map(model.components.map((c) => [c.key, c.label]));
  return card.components
    .map((c) => ({
      key: c.k,
      label: labels.get(c.k) ?? c.k,
      score: c.s,
      weight: c.w,
      metric: c.m,
      z: c.z,
    }))
    .sort((a, b) => b.weight - a.weight);
}

/** Components with no historical data, with their labels. */
export function unavailableComponents(card: DatasetCard): string[] {
  const model = POSITION_MODELS[card.position];
  const labels = new Map(model.components.map((c) => [c.key, c.label]));
  return card.unavailable.map((key) => labels.get(key) ?? key);
}
