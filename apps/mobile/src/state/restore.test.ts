import { describe, expect, it } from 'vitest';
import {
  NOTE_CLOSED_BEFORE_OPENING,
  NOTE_PICKS_DROPPED,
  restoreGame,
  restoreHistory,
  statusFrom,
} from './restore';

/**
 * Launch must never be the thing that breaks. Every case here is something
 * that can be in AsyncStorage when the app opens.
 */
const known = (id: string) => !id.startsWith('retired');
const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e';

const spins = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ sequence: i + 1, franchiseId: `f${i}`, era: '2000s' }));
const SLOTS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1', 'DEF'];
const picks = (n: number) => Array.from({ length: n }, (_, i) => ({ slot: SLOTS[i], cardId: `c${i}`, spinSequence: i + 1 }));

const result = {
  finalRating: 91.2,
  record: { wins: 14, losses: 3 },
  ending: { key: 'CONTENDER', tier: 'x' },
  breakdown: {},
  perfectEligibility: { eligible: false, failedGates: [] },
};

const game = (over: Record<string, unknown> = {}) => ({
  status: 'spun',
  spins: spins(3),
  selections: picks(2),
  startedAt: 100,
  result: null,
  assisted: false,
  respinsUsed: 0,
  mode: 'player_iq',
  gamedayKey: null,
  preferRanked: false,
  lensSnoozeUntil: 4,
  ...over,
});

describe('restoring a game in progress', () => {
  it('nothing stored, or nothing usable, leaves the defaults', () => {
    expect(restoreGame(undefined, known)).toEqual({});
    expect(restoreGame(null, known)).toEqual({});
    expect(restoreGame('garbage', known)).toEqual({});
    expect(restoreGame([1, 2], known)).toEqual({});
  });

  it('a whole game comes back as it was', () => {
    const out = restoreGame(game(), known);
    expect(out).toMatchObject({ status: 'spun', mode: 'player_iq', startedAt: 100, preferRanked: false, lensSnoozeUntil: 4 });
    expect(out.selections).toHaveLength(2);
  });

  it('a shape no build wrote resets the season but keeps the preferences', () => {
    for (const bad of [
      game({ selections: null }),
      game({ spins: 'x' }),
      game({ spins: [{ sequence: 2, franchiseId: 'a', era: 'b' }] }), // gap
      game({ selections: [{ slot: 'K', cardId: 'c0', spinSequence: 1 }] }), // no such slot
      game({ selections: [...picks(1), { slot: 'QB', cardId: 'c9', spinSequence: 2 }] }), // slot twice
      game({ selections: [{ slot: 'QB', cardId: 'c0', spinSequence: 9 }] }), // spin never dealt
    ]) {
      const out = restoreGame(bad, known);
      expect(out.status).toBe('idle');
      expect(out.selections).toEqual([]);
      expect(out.preferRanked).toBe(false);
      expect(out.mode).toBe('player_iq');
    }
  });

  it('an unknown mode from another build reads as Scout', () => {
    expect(restoreGame(game({ mode: 'blind' }), known).mode).toBe('scout');
  });

  it('a card the dataset retired is taken off the roster, not left to crash the reveal', () => {
    const selections = [...picks(6), { slot: 'DEF', cardId: 'retired-1', spinSequence: 7 }];
    const out = restoreGame(game({ status: 'complete', spins: spins(7), selections, result }), known);
    expect(out.selections).toHaveLength(6);
    // The pick from the seventh spin is gone, so that spin is open again: the
    // player chooses someone else from it rather than revealing six.
    expect(out.status).toBe('spun');
    expect(out.result).toBeNull();
  });

  it('the status is derived, never trusted', () => {
    expect(restoreGame(game({ status: 'complete' }), known).status).toBe('spun');
    expect(restoreGame(game({ status: 'spun', spins: spins(2) }), known).status).toBe('ready_to_spin');
  });

  it('a malformed result is dropped so the reveal scores again', () => {
    const full = { status: 'complete', spins: spins(7), selections: picks(7) };
    expect(restoreGame(game({ ...full, result: { finalRating: 'x' } }), known).result).toBeNull();
    expect(restoreGame(game({ ...full, result }), known).result).toEqual(result);
  });

  it('a ranked season resumes ranked when its session came back whole', () => {
    const out = restoreGame(game({ ranked: true, serverSessionId: SESSION, serverIdempotencyKey: 'key-12345678' }), known);
    expect(out).toMatchObject({ ranked: true, serverSessionId: SESSION, serverIdempotencyKey: 'key-12345678' });
  });

  it('a ranked season killed before its session opened carries on offline and says why', () => {
    const out = restoreGame(game({ ranked: true, serverSessionId: null }), known);
    expect(out).toMatchObject({ ranked: false, serverSessionId: null, serverNote: NOTE_CLOSED_BEFORE_OPENING });
  });

  it('a ranked season that lost a pick to a retired card stops being ranked', () => {
    const selections = [...picks(1), { slot: 'RB1', cardId: 'retired-2', spinSequence: 2 }];
    const out = restoreGame(
      game({ ranked: true, serverSessionId: SESSION, serverIdempotencyKey: 'key-12345678', selections }),
      known,
    );
    expect(out).toMatchObject({ ranked: false, serverNote: NOTE_PICKS_DROPPED });
  });
});

describe('the status of a game', () => {
  it('picks from an open spin, spins after a spent one', () => {
    expect(statusFrom([], [])).toBe('ready_to_spin');
    expect(statusFrom(spins(3), picks(2) as never)).toBe('spun');
    expect(statusFrom(spins(2), picks(2) as never)).toBe('ready_to_spin');
    expect(statusFrom(spins(7), picks(7) as never)).toBe('complete');
  });

  it('a refused pick taken back reopens the spin the server still holds', () => {
    // Two picks from two spins; the server refused the second.
    const remaining = picks(1);
    expect(statusFrom(spins(2), remaining as never)).toBe('spun');
  });
});

describe('restoring the history', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: '1',
    completedAt: 5,
    result,
    mode: 'scout',
    roster: [{ slot: 'QB', cardId: 'c', name: 'N', franchiseId: 'f', era: 'e', year: 2001, rating: 90 }],
    ...over,
  });

  it('keeps every whole season and loses only the broken ones', () => {
    const games = restoreHistory<{ id: string }>({
      games: [entry(), null, entry({ id: '2', result: { finalRating: null } }), entry({ id: '3' }), 'x'],
    });
    expect(games.map((g) => g.id)).toEqual(['1', '3']);
  });

  it('drops a malformed pick without dropping the season', () => {
    const [g] = restoreHistory<{ roster: unknown[] }>({ games: [entry({ roster: [null, ...entry().roster] })] });
    expect(g!.roster).toHaveLength(1);
  });

  it('survives storage holding anything at all', () => {
    expect(restoreHistory(undefined)).toEqual([]);
    expect(restoreHistory({ games: 'nope' })).toEqual([]);
    expect(restoreHistory(42)).toEqual([]);
  });
});
