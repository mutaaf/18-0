import { describe, expect, it } from 'vitest';
import { parseManifest, parseStatLines } from './parse';

/**
 * The published stat-line table is fetched at boot, cached on the device, and
 * then outlives the build that fetched it. Everything here is a rule about
 * input nobody controls at the moment it is read.
 *
 * The rule that matters most is the last one: this can correct what a card
 * says and can never change what a card is worth.
 */

const KNOWN = new Set(['00-0000001-1990', '00-0000002-1991']);
const knows = (id: string) => KNOWN.has(id);

const table = (cards: Record<string, unknown>, revision = 'abc123') => ({ revision, cards });

describe('reading a published table', () => {
  it('takes a well-formed one', () => {
    const parsed = parseStatLines(
      table({ '00-0000001-1990': [['CAR', '125'], ['YDS', '698']] }),
      knows,
    );
    expect(parsed?.revision).toBe('abc123');
    expect(parsed?.cards.get('00-0000001-1990')).toEqual([
      { label: 'CAR', value: '125' },
      { label: 'YDS', value: '698' },
    ]);
  });

  it('refuses anything that is not a table', () => {
    for (const junk of [null, undefined, 42, 'nope', [], {}, { cards: {} }, { revision: 'a' }]) {
      expect(parseStatLines(junk, knows), JSON.stringify(junk)).toBeNull();
    }
    expect(parseStatLines({ revision: 'a', cards: [] }, knows)).toBeNull();
    expect(parseStatLines({ revision: '', cards: {} }, knows)).toBeNull();
  });

  /**
   * "Nothing to correct" and "unreadable" are different answers, and only one
   * of them is a fault. An empty table is a legitimate thing to publish.
   */
  it('distinguishes an empty table from a broken one', () => {
    expect(parseStatLines(table({}), knows)?.cards.size).toBe(0);
    expect(parseStatLines('not a table', knows)).toBeNull();
  });

  it('drops a card this build has never heard of', () => {
    const parsed = parseStatLines(
      table({
        '00-0000001-1990': [['CAR', '125']],
        'a-card-from-the-future': [['CAR', '999']],
      }),
      knows,
    );
    expect([...(parsed?.cards.keys() ?? [])]).toEqual(['00-0000001-1990']);
  });

  it('drops a card whose entries are malformed, and keeps the rest', () => {
    const parsed = parseStatLines(
      table({
        '00-0000001-1990': [['CAR', '125']],
        '00-0000002-1991': [['CAR', 125]], // a number where a string belongs
      }),
      knows,
    );
    expect([...(parsed?.cards.keys() ?? [])]).toEqual(['00-0000001-1990']);
  });

  it('refuses entries that would break a row', () => {
    const bad: unknown[] = [
      [['THIS_LABEL_IS_TOO_LONG', '1']],
      [['CAR', '1234567890123456']],
      [['CAR']],
      [['CAR', '1', 'extra']],
      [[]],
      ['CAR,1'],
      [],
      [['A', '1'], ['B', '2'], ['C', '3'], ['D', '4'], ['E', '5'], ['F', '6'], ['G', '7']],
    ];
    for (const entries of bad) {
      const parsed = parseStatLines(table({ '00-0000001-1990': entries }), knows);
      expect(parsed?.cards.size, JSON.stringify(entries)).toBe(0);
    }
  });

  /**
   * The invariant. The payload is pairs of strings keyed by cards that already
   * exist, so there is no shape in which a rating, a name or a position could
   * arrive -- and a key the bundle does not know is dropped rather than added.
   */
  it('cannot carry anything but a label and a value', () => {
    const parsed = parseStatLines(
      table({
        '00-0000001-1990': [['CAR', '125']],
        // Everything an attacker or a broken generator might try to smuggle.
        rating: 99.9,
        cards: { '00-0000001-1990': { rating: 99.9 } },
        '00-0000001-1990:rating': [['RATING', '99.9']],
      }),
      knows,
    );
    expect([...(parsed?.cards.keys() ?? [])]).toEqual(['00-0000001-1990']);
    const only = parsed?.cards.get('00-0000001-1990') ?? [];
    for (const stat of only) expect(Object.keys(stat).sort()).toEqual(['label', 'value']);
  });
});

describe('reading the manifest', () => {
  it('takes a well-formed one', () => {
    expect(parseManifest({ revision: 'abc', cards: 4872, bytes: 355028 })).toEqual({
      revision: 'abc',
      cards: 4872,
      bytes: 355028,
    });
  });

  it('tolerates missing counts but not a missing revision', () => {
    expect(parseManifest({ revision: 'abc' })).toEqual({ revision: 'abc', cards: 0, bytes: 0 });
    expect(parseManifest({ cards: 1 })).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('abc')).toBeNull();
  });
});
