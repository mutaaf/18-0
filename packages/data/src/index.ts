import { POSITION_MODELS, type EraKey, type Position, type RatedSeason } from '@18-0/domain';
import raw from '../generated/dataset.json' with { type: 'json' };
import type { BootCard, Dataset, DatasetCard, DatasetComponent, DatasetFranchise } from './schema.js';

export * from './schema.js';
export * from './eras.js';

/**
 * The bundled historical dataset.
 *
 * NFL history is immutable, so this is computed once at build time and shipped
 * with the app: spins, eligible lists and ratings are all resolved locally with
 * no network at all.
 */
export const DATASET = raw as unknown as Dataset;

const FRANCHISE_BY_ID = new Map(DATASET.franchises.map((f) => [f.id, f]));
const CARD_BY_ID = new Map(DATASET.cards.map((c) => [c.id, c]));

/** Cards indexed by franchise-era, then by position — the spin's eligible list. */
const BUCKETS = (() => {
  const map = new Map<string, Map<Position, BootCard[]>>();
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

/** Every eligible card for one spin, best first. Flattened once per bucket. */
const FLAT_BUCKETS = new Map<string, BootCard[]>();

export function eligibleCards(franchiseId: string, era: EraKey): BootCard[] {
  const key = bucketKey(franchiseId, era);
  const cached = FLAT_BUCKETS.get(key);
  if (cached) return cached;
  const bucket = BUCKETS.get(key);
  const flat = bucket ? [...bucket.values()].flat().sort((a, b) => b.rating - a.rating) : [];
  FLAT_BUCKETS.set(key, flat);
  return flat;
}

export function eligibleByPosition(franchiseId: string, era: EraKey, position: Position): BootCard[] {
  return BUCKETS.get(bucketKey(franchiseId, era))?.get(position) ?? [];
}

/** Adapts a dataset card into the shape the scoring domain expects. */
export function toRatedSeason(card: BootCard): RatedSeason {
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
/**
 * The same card, described without naming anybody.
 *
 * franchiseEraTagline() names the three highest-rated players in the pool,
 * which is exactly the information Player IQ exists to withhold: printed on
 * the spin card it hands over the answer, and since only blind seasons rank,
 * it would have made the leaderboard a reading test after all.
 *
 * This says how the pool is *shaped* instead. Counts per position reveal how
 * many receivers there are to choose between and nothing whatsoever about
 * which of them is any good, so it is still specific to the franchise-era and
 * still useful when deciding which slot to fill from this spin.
 */
const SHAPE_BY_BUCKET = new Map<string, string>();

export function franchiseEraShape(franchiseId: string, era: EraKey): string {
  const key = bucketKey(franchiseId, era);
  const cached = SHAPE_BY_BUCKET.get(key);
  if (cached !== undefined) return cached;

  const cards = eligibleCards(franchiseId, era);
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.position, (counts.get(card.position) ?? 0) + 1);

  // A stable order, so a tie does not describe the same pool two ways on two
  // spins of the same franchise-era.
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || POSITION_ORDER.indexOf(a[0]) - POSITION_ORDER.indexOf(b[0]),
  );

  const noun = cards.length === 1 ? 'season' : 'seasons';
  const deepest = ranked[0];
  const line = deepest
    ? `${cards.length} ${noun} here, deepest at ${POSITION_WORD[deepest[0]] ?? deepest[0]}.`
    : '';

  SHAPE_BY_BUCKET.set(key, line);
  return line;
}

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'DEF'];

const POSITION_WORD: Record<string, string> = {
  QB: 'quarterback',
  RB: 'running back',
  WR: 'receiver',
  TE: 'tight end',
  DEF: 'defense',
};


export function displayName(card: BootCard): string {
  if (card.position !== 'DEF') return card.name;
  return `${card.year} ${franchise(card.franchiseId).nick} Defense`;
}

export function cardById(id: string): BootCard | undefined {
  return CARD_BY_ID.get(id);
}

export interface ComponentBreakdown {
  readonly key: string;
  readonly label: string;
  readonly score: number;
  readonly weight: number;
  readonly metric: string | null;
  readonly z: number | null;
}

/**
 * Component scores, loaded on first use.
 *
 * They are 60% of the dataset's bytes and only the detail screen reads them, so
 * they are a separate artifact that never touches the startup path.
 */
type ComponentIndex = Record<string, { c: DatasetComponent[]; u: string[] }>;
let componentIndex: ComponentIndex | null = null;

function components(): ComponentIndex {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  componentIndex ??= require('../generated/card-components.json') as ComponentIndex;
  return componentIndex;
}

/** Rehydrates a card's component scores with their human labels. */
export function componentBreakdown(card: BootCard): ComponentBreakdown[] {
  const model = POSITION_MODELS[card.position];
  const labels = new Map(model.components.map((c) => [c.key, c.label]));
  return (components()[card.id]?.c ?? [])
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
export function unavailableComponents(card: BootCard): string[] {
  const model = POSITION_MODELS[card.position];
  const labels = new Map(model.components.map((c) => [c.key, c.label]));
  return (components()[card.id]?.u ?? []).map((key) => labels.get(key) ?? key);
}
