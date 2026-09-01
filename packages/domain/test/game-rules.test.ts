import { describe, expect, it } from 'vitest';
import {
  eligibleSlotsFor,
  filledSlotCount,
  isRosterComplete,
  openSlots,
  spinHasPlayableOption,
  validateSelection,
  type PartialRoster,
  type SpinResult,
} from '../src/index.js';
import { makeSeason } from './helpers.js';

const spin: SpinResult = { sequence: 1, franchiseId: 'test-franchise', era: '1990s' };

describe('roster assembly rules (PRFAQ §6.1)', () => {
  it('starts with seven open slots', () => {
    expect(openSlots({})).toHaveLength(7);
    expect(filledSlotCount({})).toBe(0);
    expect(isRosterComplete({})).toBe(false);
  });

  it('offers a running back both RB slots', () => {
    const rb = makeSeason('RB1', { rating: 90, entityId: 'rb-a' });
    expect(eligibleSlotsFor(rb, {})).toEqual(['RB1', 'RB2']);
  });

  it('offers a quarterback only the QB slot', () => {
    const qb = makeSeason('QB', { rating: 90, entityId: 'qb-a' });
    expect(eligibleSlotsFor(qb, {})).toEqual(['QB']);
  });

  it('drops a slot once it is filled', () => {
    const rb = makeSeason('RB1', { rating: 90, entityId: 'rb-a' });
    const roster: PartialRoster = {
      RB1: { slot: 'RB1', season: makeSeason('RB1', { rating: 88, entityId: 'rb-b' }), spinSequence: 1 },
    };
    expect(eligibleSlotsFor(rb, roster)).toEqual(['RB2']);
  });

  it('rejects a position mismatch', () => {
    const qb = makeSeason('QB', { rating: 90, entityId: 'qb-a' });
    const result = validateSelection({ season: qb, slot: 'RB1', roster: {}, spin });
    expect(result).toMatchObject({ ok: false, reason: 'POSITION_MISMATCH' });
  });

  it('rejects a filled slot', () => {
    const qb = makeSeason('QB', { rating: 90, entityId: 'qb-a' });
    const roster: PartialRoster = {
      QB: { slot: 'QB', season: makeSeason('QB', { rating: 91, entityId: 'qb-b' }), spinSequence: 1 },
    };
    expect(validateSelection({ season: qb, slot: 'QB', roster, spin })).toMatchObject({
      ok: false,
      reason: 'SLOT_ALREADY_FILLED',
    });
  });

  it('rejects the same identity twice, even from a different season', () => {
    const roster: PartialRoster = {
      RB1: { slot: 'RB1', season: makeSeason('RB1', { rating: 95, entityId: 'barry' }), spinSequence: 1 },
    };
    const otherSeason = {
      ...makeSeason('RB2', { rating: 93, entityId: 'barry' }),
      seasonYear: 1994,
    };
    expect(validateSelection({ season: otherSeason, slot: 'RB2', roster, spin })).toMatchObject({
      ok: false,
      reason: 'DUPLICATE_ENTITY',
    });
    expect(eligibleSlotsFor(otherSeason, roster)).toEqual([]);
  });

  it('rejects a card that does not belong to the current spin', () => {
    const stale = { ...makeSeason('WR1', { rating: 95, entityId: 'wr-a' }), era: '1980s' as const };
    expect(validateSelection({ season: stale, slot: 'WR1', roster: {}, spin })).toMatchObject({
      ok: false,
      reason: 'SPIN_MISMATCH',
    });
  });

  it('accepts a legal selection', () => {
    const wr = makeSeason('WR1', { rating: 95, entityId: 'wr-a' });
    expect(validateSelection({ season: wr, slot: 'WR1', roster: {}, spin })).toEqual({ ok: true });
  });
});

describe('dead-end guard (PRFAQ §6.3)', () => {
  it('detects a spin with nothing playable', () => {
    const roster: PartialRoster = {
      QB: { slot: 'QB', season: makeSeason('QB', { rating: 90, entityId: 'qb-b' }), spinSequence: 1 },
    };
    const onlyQbs = [makeSeason('QB', { rating: 95, entityId: 'qb-a' })];
    expect(spinHasPlayableOption(onlyQbs, roster)).toBe(false);
  });

  it('detects a spin with a playable option', () => {
    const roster: PartialRoster = {
      QB: { slot: 'QB', season: makeSeason('QB', { rating: 90, entityId: 'qb-b' }), spinSequence: 1 },
    };
    const pool = [
      makeSeason('QB', { rating: 95, entityId: 'qb-a' }),
      makeSeason('TE1', { rating: 88, entityId: 'te-a' }),
    ];
    expect(spinHasPlayableOption(pool, roster)).toBe(true);
  });

  it('treats an empty eligible list as a dead end', () => {
    expect(spinHasPlayableOption([], {})).toBe(false);
  });
});
