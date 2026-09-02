import { describe, expect, it } from 'vitest';
import { DATASET } from './index.js';
import { headshotUrl } from './headshots.js';

/**
 * The table is generated, and a break in it is invisible: a card just shows the
 * fallback initials and nobody notices the photographs stopped loading.
 */
describe('headshots', () => {
  const players = [...new Set(DATASET.cards.filter((c) => c.position !== 'DEF').map((c) => c.entityId))];

  it('every player in the dataset has one', () => {
    const missing = players.filter((id) => !headshotUrl(id));
    expect(missing).toEqual([]);
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
