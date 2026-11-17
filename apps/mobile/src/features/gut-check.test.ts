import { describe, expect, it } from 'vitest';
import { DECK_SIZE, buildDeck, drawWeight, summarize, type DeckCard } from './gut-check';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DEF'];
const pool: DeckCard[] = Array.from({ length: 200 }, (_, i) => ({
  id: `c${i}`,
  position: POSITIONS[i % POSITIONS.length]!,
  rating: 60 + (i % 40),
  games: i % 7 === 0 ? 4 : 16,
}));

/** A seeded generator, so a failing deck can be reproduced. */
const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};

describe('the Gut Check deck', () => {
  it('deals ten different cards', () => {
    const deck = buildDeck({ pool, recent: [], voted: () => false, random: seeded(1) });
    expect(deck).toHaveLength(DECK_SIZE);
    expect(new Set(deck.map((c) => c.id)).size).toBe(DECK_SIZE);
  });

  it('never deals a card the player already has an opinion of', () => {
    const voted = new Set(pool.slice(0, 150).map((c) => c.id));
    const deck = buildDeck({ pool, recent: ['c1', 'c2'], voted: (id) => voted.has(id), random: seeded(2) });
    expect(deck.every((c) => !voted.has(c.id))).toBe(true);
  });

  it('leads with a few of the player’s own recent cards, not all of them', () => {
    const recent = ['c10', 'c11', 'c12', 'c13', 'c14'];
    const deck = buildDeck({ pool, recent, voted: () => false, random: seeded(3) });
    expect(deck.slice(0, 3).map((c) => c.id)).toEqual(['c10', 'c11', 'c12']);
    expect(deck.filter((c) => recent.includes(c.id))).toHaveLength(3);
  });

  it('keeps any one position to three', () => {
    for (let s = 1; s < 30; s++) {
      const deck = buildDeck({ pool, recent: [], voted: () => false, random: seeded(s) });
      for (const p of POSITIONS) expect(deck.filter((c) => c.position === p).length).toBeLessThanOrEqual(3);
    }
  });

  it('leaves out part-time seasons, except a defense', () => {
    const deck = buildDeck({ pool, recent: [], voted: () => false, random: seeded(4), size: 15 });
    expect(deck.every((c) => c.position === 'DEF' || c.games >= 10)).toBe(true);
  });

  it('deals what is left when the pool runs short, rather than looping', () => {
    const small = pool.slice(0, 4);
    expect(buildDeck({ pool: small, recent: [], voted: () => false, random: seeded(5) }).length).toBeLessThanOrEqual(4);
  });

  it('draws stars more often than depth, but depth still comes up', () => {
    expect(drawWeight(98)).toBeGreaterThan(drawWeight(80) * 3);
    expect(drawWeight(55)).toBeGreaterThan(0);
  });
});

describe('the end-of-round line', () => {
  it('calls a round of all-fair in sync', () => {
    expect(summarize(Array(10).fill('fair')).title).toBe('In sync');
  });

  it('calls mostly too-high a tough grader', () => {
    expect(summarize(['too_high', 'too_high', 'too_high', 'fair', 'skip']).title).toBe('Tough grader');
  });

  it('counts skips without letting them decide the title', () => {
    const s = summarize(['skip', 'skip', 'skip', 'too_low', 'too_low']);
    expect(s).toMatchObject({ skipped: 3, tooLow: 2, title: 'Talent scout' });
  });

  it('has something honest to say when nothing was called', () => {
    expect(summarize(['skip']).title).toBe('Bye week');
  });
});
