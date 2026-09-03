import { createHash } from 'node:crypto';
import type { DatasetCard, DatasetCombo, DatasetEra } from './schema.js';

/**
 * A digest of what the dataset actually offers a player.
 *
 * This replaced a wall-clock `generatedAt`, which nothing read and which made a
 * 1.5 MB file differ on every build even when not one rating had moved. The
 * point is a build that is reproducible -- same inputs, same bytes -- so a diff
 * on `dataset.json` means a card or a rating genuinely changed.
 *
 * It is deliberately **not** a hash of the JSON. Hashing an object graph makes
 * the digest depend on key order, which is a property of the code that built
 * the object rather than of the data, and it leaves nobody able to check the
 * number independently. This hashes a canonical, sorted, line-per-fact form:
 *
 *   era   1980_1989
 *   combo dal:1990_1998
 *   card  SmitEm00-1995 RB dal 1990_1998 1995 97.23
 *
 * Sorted, so the order the build happened to produce them in cannot matter.
 * One line per fact, so anyone with the dataset can regenerate it in a few
 * lines and compare against what the ledger publishes.
 */
export function datasetFingerprint(
  eras: readonly DatasetEra[],
  combos: readonly DatasetCombo[],
  cards: readonly Pick<DatasetCard, 'id' | 'position' | 'franchiseId' | 'era' | 'year' | 'rating'>[],
): string {
  const lines = [
    ...eras.map((e) => `era ${e.key}`),
    ...combos.map((c) => `combo ${c.franchiseId}:${c.era}`),
    ...cards.map(
      (c) => `card ${c.id} ${c.position} ${c.franchiseId} ${c.era} ${c.year} ${c.rating}`,
    ),
  ].sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}
