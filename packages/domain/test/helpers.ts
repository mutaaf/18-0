import {
  ROSTER_SLOTS,
  SLOT_POSITION,
  type Archetype,
  type CompletedRoster,
  type RatedSeason,
  type RosterSlot,
} from '../src/index.js';

export interface SlotSpec {
  rating: number;
  archetypes?: Archetype[];
  entityId?: string;
  name?: string;
}

export type RosterSpec = Record<RosterSlot, number | SlotSpec>;

function normalize(spec: number | SlotSpec): SlotSpec {
  return typeof spec === 'number' ? { rating: spec } : spec;
}

export function makeSeason(slot: RosterSlot, spec: number | SlotSpec): RatedSeason {
  const { rating, archetypes = [], entityId, name } = normalize(spec);
  const id = entityId ?? `${slot}-entity`;
  return {
    id: `${id}-season`,
    entityId: id,
    entityType: slot === 'DEF' ? 'defense' : 'player',
    displayName: name ?? `${slot} ${rating}`,
    position: SLOT_POSITION[slot],
    franchiseId: 'test-franchise',
    seasonYear: 1995,
    era: '1990s',
    rating,
    archetypes,
    ratingModelVersion: '1.0.0',
  };
}

/** Builds a complete roster from a slot -> rating (or full spec) map. */
export function makeRoster(spec: RosterSpec): CompletedRoster {
  return Object.fromEntries(
    ROSTER_SLOTS.map((slot) => [
      slot,
      { slot, season: makeSeason(slot, spec[slot]), spinSequence: 1 },
    ]),
  ) as CompletedRoster;
}

/** Every slot at the same rating — the cleanest way to probe a curve. */
export function flatRoster(rating: number): CompletedRoster {
  return makeRoster(
    Object.fromEntries(ROSTER_SLOTS.map((s) => [s, rating])) as RosterSpec,
  );
}
