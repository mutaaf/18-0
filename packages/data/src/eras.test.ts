import { describe, expect, it } from 'vitest';
import { DATASET, eligibleCards } from './index.js';
import { ERA_TABLE, FRANCHISE_ERA_STORY, franchiseEraStory } from './eras.js';
import { FRANCHISE_ERA_RECORD } from './franchise-era-records.js';

/**
 * The story table is hand-written, and a typo in it fails silently: an unknown
 * key simply never matches, and the card falls back to the generated line with
 * nothing to show that anything is wrong. Keying the Rams as `la` when the
 * dataset uses `lar` did exactly that.
 */
/**
 * Does this line name that player?
 *
 * Case-sensitive and word-bounded. A surname is a proper noun and appears
 * capitalised, while the words a generated line is built from are not. Matching
 * loosely flagged "best at 11-5 in 2014" for naming Jahvid Best.
 */
function names(story: string, surname: string): boolean {
  return new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(story);
}

describe('franchise-era stories', () => {
  const franchises = new Set(DATASET.franchises.map((f) => f.id));
  const eras = new Set(ERA_TABLE.map((e) => e.key as string));

  it('every key names a franchise and an era that exist', () => {
    for (const key of Object.keys(FRANCHISE_ERA_STORY)) {
      const [franchiseId, era] = key.split(':');
      expect(franchises, `${key}: unknown franchise "${franchiseId}"`).toContain(franchiseId);
      expect(eras, `${key}: unknown era "${era}"`).toContain(era);
    }
  });

  it('every key describes a franchise-era that can actually be spun', () => {
    for (const key of Object.keys(FRANCHISE_ERA_STORY)) {
      const [franchiseId, era] = key.split(':');
      expect(
        eligibleCards(franchiseId!, era as never).length,
        `${key}: no cards, so this line can never be shown`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * The reason this table exists. Naming the best players is the game's own
   * answer key, and only blind seasons rank, so a story that leaks one is worse
   * than no story at all.
   */
  it('no story names a player in its own franchise-era', () => {
    for (const [key, story] of Object.entries(FRANCHISE_ERA_STORY)) {
      const [franchiseId, era] = key.split(':');
      for (const card of eligibleCards(franchiseId!, era as never)) {
        if (card.position === 'DEF' || !card.name) continue;
        const surname = card.name.split(' ').pop()!;
        if (surname.length < 4) continue; // too short to match meaningfully
        expect(
          names(story, surname),
          `${key} names ${card.name}, who is in that pool`,
        ).toBe(false);
      }
    }
  });

  /**
   * The computed table is the floor. If a franchise-era a spin can land on has
   * no line, the card falls back to describing the pool's shape — which is not
   * wrong, just duller, and would go unnoticed.
   */
  it('every spinnable franchise-era has something to say', () => {
    const missing: string[] = [];
    for (const card of DATASET.cards) {
      const key = `${card.franchiseId}:${card.era}`;
      if (!franchiseEraStory(card.franchiseId, card.era)) missing.push(key);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('the computed lines name no player from their own pool', () => {
    for (const [key, story] of Object.entries(FRANCHISE_ERA_RECORD)) {
      const [franchiseId, era] = key.split(':');
      for (const card of eligibleCards(franchiseId!, era as never)) {
        if (card.position === 'DEF' || !card.name) continue;
        const surname = card.name.split(' ').pop()!;
        if (surname.length < 4) continue;
        expect(
          names(story, surname),
          `${key} names ${card.name}, who is in that pool`,
        ).toBe(false);
      }
    }
  });

  it('a hand-written line beats the computed one', () => {
    // Seattle 2010-2014 has both; the nickname is the better sentence.
    expect(franchiseEraStory('sea', '2010_2014')).toBe('The Legion of Boom.');
    expect(FRANCHISE_ERA_RECORD['sea:2010_2014']).toContain('Super Bowl');
  });
});
