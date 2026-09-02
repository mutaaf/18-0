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
 * One line about the franchise-era actually on the card.
 *
 * The spin card used to print the *era's* tagline, which is written about the
 * era as a whole. Dallas in 2020-2025 was therefore introduced with a line
 * about Kansas City, and a player looking at a Cowboys card was told about
 * Mahomes. The flavour is only flavour if it is about the thing you were dealt.
 *
 * So it is built from the pool the spin will actually draw from: the three
 * highest-rated players in it, each counted once at their best season. That is
 * true by construction, specific to all 157 franchise-eras, and it names the
 * cards the player is about to be choosing between.
 */
const TAGLINE_BY_BUCKET = new Map<string, string>();

export function franchiseEraTagline(franchiseId: string, era: EraKey): string {
  const key = bucketKey(franchiseId, era);
  const cached = TAGLINE_BY_BUCKET.get(key);
  if (cached !== undefined) return cached;

  // One entry per player, at their best season, so a franchise with the same
  // man three years running does not spend the whole line on him.
  const best = new Map<string, BootCard>();
  for (const card of eligibleCards(franchiseId, era)) {
    const existing = best.get(card.entityId);
    if (!existing || card.rating > existing.rating) best.set(card.entityId, card);
  }

  const top = [...best.values()].sort((a, b) => b.rating - a.rating).slice(0, 3);
  const names = top.map(shortLabel);

  const line =
    names.length >= 3
      ? `${names[0]}, ${names[1]} and ${names[2]}`
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : (names[0] ?? '');

  TAGLINE_BY_BUCKET.set(key, line);
  return line;
}

/**
 * How a card reads inside a sentence.
 *
 * Surnames, because "Lamb, Pickens and the 2022 defense" is a headline and
 * "CeeDee Lamb, George Pickens and the 2022 Cowboys Defense" is a list. A
 * single-word name is left alone.
 */
function shortLabel(card: BootCard): string {
  if (card.position === 'DEF') return `the ${card.year} defense`;

  const parts = card.name.replace(/\./g, '').split(' ').filter(Boolean);
  // Skip a generational suffix. Twenty players in the dataset carry one, and
  // taking the last word turned Robert Griffin III into "III".
  let last = parts.length - 1;
  while (last > 0 && SUFFIXES.has(parts[last]!.toLowerCase())) last--;
  return last > 0 ? parts[last]! : card.name;
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

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
