import { describe, expect, it } from 'vitest';
import { DATASET } from './index.js';
import { headshotUrl } from './headshots.js';

/**
 * The table is generated, and a break in it is invisible: a card just shows the
 * fallback initials and nobody notices the photographs stopped loading.
 */
describe('headshots', () => {
  const players = [...new Set(DATASET.cards.filter((c) => c.position !== 'DEF').map((c) => c.entityId))];

  /**
   * The table is built from nflverse's rosters, which start in 1999 and key on
   * nflverse's own player ids. A hydrated pre-1999 player is identified by his
   * id in the licensed source instead, is in no nflverse roster, and has no
   * photograph on the NFL's CDN to point at. The card handles it — a missing
   * portrait leaves the team wash — so this is absence by design, like a team
   * defence, rather than the silent break this file exists to catch.
   */
  const photographed = players.filter((id) => /^00-\d+$/.test(id));

  it('every nflverse-era player has one', () => {
    const missing = photographed.filter((id) => !headshotUrl(id));
    expect(missing).toEqual([]);
  });

  it('covers the great majority of the dataset', () => {
    // A guard on the narrowing above: if the id shape ever changes and the
    // filter starts excluding modern players too, this fails rather than
    // quietly shrinking the set the first test checks.
    expect(photographed.length / players.length).toBeGreaterThan(0.6);
  });

  it('a hydrated pre-1999 player has no photograph, and says so', () => {
    const older = players.find((id) => !/^00-\d+$/.test(id));
    expect(older).toBeDefined();
    expect(headshotUrl(older!)).toBeNull();
  });

  it('rebuilds a real URL rather than a token', () => {
    const url = headshotUrl(players[0]!);
    expect(url).toMatch(/^https:\/\/static\.www\.nfl\.com\/image\/(private|upload)\/f_auto,q_auto\/league\/\w+$/);
  });

  it('a team defence has nobody to photograph', () => {
    const def = DATASET.cards.find((c) => c.position === 'DEF')!;
    expect(headshotUrl(def.entityId)).toBeNull();
  });

  it('an unknown id is null, not a broken URL', () => {
    expect(headshotUrl('not-a-player')).toBeNull();
  });
});
