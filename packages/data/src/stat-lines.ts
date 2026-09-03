import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatasetCard } from './schema.js';

/**
 * The stat lines, published so a stale app can catch up on them.
 *
 * Everything a card shows is baked into the bundle, which is what makes the
 * game work on a plane. The cost is that a *display* mistake ships on the app's
 * release cadence: pre-1999 defences showed `— SACK` and running backs showed
 * `698 RUSH` where 698 was yards, and both were correct in the repository hours
 * before any phone could see it. The web build follows `main` within a minute;
 * a native build follows whenever somebody rebuilds it.
 *
 * So the stat lines are also written as a static file beside `ledger.html`,
 * served by the same GitHub Pages deploy, and the app fetches them when its own
 * bundle is behind. No server, no schema, no migration -- this is text that
 * cannot affect a result, and it should not cost a table to fix.
 *
 * ---------------------------------------------------------------------------
 * What this may never carry
 * ---------------------------------------------------------------------------
 *
 * Labels and values. Nothing else, and the shape has no room for anything
 * else: each entry is a pair of strings.
 *
 * A rating decides a leaderboard and is recomputed server-side from Postgres to
 * prove nobody cheated (CLAUDE.md, invariant 1). If this file could carry one,
 * a stale phone and a fresh one would disagree about what a card is worth, and
 * the disagreement would arrive over the network. It carries display text, the
 * client validates every entry against the cards it already has, and anything
 * unrecognised is discarded.
 *
 * ---------------------------------------------------------------------------
 * Why this has a revision of its own
 * ---------------------------------------------------------------------------
 *
 * Neither existing identifier moves when a stat line does. `version` is a
 * string somebody types, and the fix that prompted all this -- carries and
 * yards on a running back -- did not touch it. `fingerprint` covers card
 * identity and ratings, deliberately, so it did not move either: no rating
 * changed, which was the point.
 *
 * So the revision is a hash of the published table itself, stamped into
 * `dataset.json` in the same run. The bundle therefore knows which revision it
 * was built with, and comparing two strings is the whole staleness check.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, '../../../apps/mobile/public');

/** `[label, value]`. Half the bytes of `{ label, value }`, for 4,872 cards. */
export type PublishedStat = readonly [label: string, value: string];

export interface PublishedStatLines {
  readonly revision: string;
  readonly version: string;
  readonly cards: Readonly<Record<string, readonly PublishedStat[]>>;
}

/** What the app fetches first: enough to decide whether to fetch the rest. */
export interface StatLineManifest {
  /** sha256 of the published table. The only thing the client compares. */
  readonly revision: string;
  /** The dataset version that produced it. Human context, never compared. */
  readonly version: string;
  readonly cards: number;
  readonly bytes: number;
}

/** The table as it will be published, so hashing and writing cannot diverge. */
function payloadFor(revision: string, version: string, cards: readonly DatasetCard[]) {
  return {
    revision,
    version,
    cards: Object.fromEntries(
      cards.map((card) => [card.id, card.stats.map((s) => [s.label, s.value] as PublishedStat)]),
    ),
  };
}

/**
 * The revision of a set of stat lines.
 *
 * Computed from the cards rather than from the file, so `build.ts` can stamp it
 * into `dataset.json` before either artifact is written.
 */
export function statLinesRevision(cards: readonly DatasetCard[]): string {
  const lines = cards
    .map((card) => `${card.id} ${card.stats.map((s) => `${s.label}=${s.value}`).join(' ')}`)
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Writes both files and returns what was written.
 *
 * Two files rather than one so the common case is nearly free. An app on the
 * current dataset -- every fresh install -- reads a manifest of about eighty
 * bytes, sees a version it already has, and stops. Only a phone that is
 * actually behind pays for the table.
 */
export function writeStatLines(
  revision: string,
  version: string,
  cards: readonly DatasetCard[],
): StatLineManifest & { readonly path: string } {
  const body = JSON.stringify(payloadFor(revision, version, cards));
  const path = resolve(PUBLIC, 'stat-lines.json');
  writeFileSync(path, body);

  const manifest: StatLineManifest = {
    revision,
    version,
    cards: cards.length,
    bytes: Buffer.byteLength(body),
  };
  writeFileSync(resolve(PUBLIC, 'stat-lines-manifest.json'), JSON.stringify(manifest));

  return { ...manifest, path };
}
