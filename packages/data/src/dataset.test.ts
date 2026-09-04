import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RATING_MODEL_VERSION, scoringConfigForVersion } from '@18-0/domain';
import { DATASET } from './index.js';

/**
 * Which model produced these ratings, asserted rather than asserted-to.
 *
 * `build.ts` used to restate the model version as a literal. The domain moved
 * to 1.3.0 when the perfection gates were raised; the dataset was rebuilt
 * afterwards and still stamped every card 1.2.0, so 4,872 cards claimed a model
 * that had not produced them. Nothing caught it, because the client bundle and
 * the seeded rows both read the stamp from that one literal: `versionCheck` in
 * complete-game compared 1.2.0 against 1.2.0, agreed, and stayed quiet. A
 * constant cannot detect a change in the thing it is supposed to be tracking,
 * and the detector that was supposed to notice was pinned shut by the same bug.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = resolve(HERE, '../../../supabase/seed/0001_dataset.sql');

describe('the shipped dataset says which model produced it', () => {
  it('carries the domain version rather than a copy of it', () => {
    // Fails when the model moves and the dataset is not rebuilt -- which is
    // the release that ships ratings labelled with the wrong curve.
    expect(DATASET.ratingModelVersion).toBe(RATING_MODEL_VERSION);
  });

  it('names a model the registry can still recompute', () => {
    // Invariant 1: a stored game is re-derivable forever. A stamp the registry
    // does not know is a game that can never be recomputed.
    expect(() => scoringConfigForVersion(DATASET.ratingModelVersion)).not.toThrow();
  });

  it('agrees with the seed, so the bundle and the database cannot split', () => {
    // The server scores from `season_cards` and the client previews from the
    // bundle. Regenerating one without the other is the documented way to make
    // previews disagree with results, so the two stamps are compared directly.
    const sql = readFileSync(SEED, 'utf8');
    const stamps = [...new Set([...sql.matchAll(/'(\d+\.\d+\.\d+)'/g)].map((m) => m[1]))];
    expect(stamps).toEqual([DATASET.ratingModelVersion]);
  });
});
