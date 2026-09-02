import { describe, expect, it } from 'vitest';
import { DATASET, eligibleCards } from './index.js';
import { ERA_TABLE, FRANCHISE_ERA_STORY, franchiseEraStory } from './eras.js';

/**
 * The story table is hand-written, and a typo in it fails silently: an unknown
 * key simply never matches, and the card falls back to the generated line with
 * nothing to show that anything is wrong. Keying the Rams as `la` when the
 * dataset uses `lar` did exactly that.
 */
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
          story.toLowerCase().includes(surname.toLowerCase()),
          `${key} names ${card.name}, who is in that pool`,
        ).toBe(false);
      }
    }
  });

  it('returns nothing for a franchise-era with no story', () => {
    expect(franchiseEraStory('nyj', '2010_2014')).toBe('');
  });
});
