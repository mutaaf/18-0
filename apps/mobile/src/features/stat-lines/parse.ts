import type { StatLine } from '@18-0/data';

/**
 * Reading a stat-line table that arrived over the network.
 *
 * Pure, and separate from the runtime next door, for the same reason the flag
 * registry is: it is the part with rules worth testing, and it must not import
 * React Native to be tested.
 *
 * The rules are all one rule. **This is untrusted input**, even though it comes
 * from our own deploy: it is fetched at boot, cached on the device, and then
 * outlives the build that fetched it. A malformed entry must cost that entry
 * and nothing else -- never a crash on a phone that has already shipped, and
 * never a card whose line is a thousand characters wide because somebody's
 * generator hiccuped.
 *
 * What it structurally cannot carry is a rating. Every entry is two strings,
 * matched to a card the bundle already has. A card id the bundle does not know
 * is dropped rather than added, so this can correct what a card *says* and can
 * never invent one, remove one, or change what one is worth.
 */

/** Long enough for `CMP%`, short enough that nothing can break a row. */
const MAX_LABEL = 8;
/** Long enough for `1,934`. */
const MAX_VALUE = 12;
/** Positions publish four. Six is slack, not an invitation. */
const MAX_STATS_PER_CARD = 6;

export interface ParsedStatLines {
  readonly revision: string;
  readonly cards: ReadonlyMap<string, readonly StatLine[]>;
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** One card's entries, or null if any of them is not a pair of short strings. */
function readEntries(value: unknown): StatLine[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STATS_PER_CARD) {
    return null;
  }
  const out: StatLine[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [label, text] = entry as unknown[];
    if (!isString(label) || !isString(text)) return null;
    if (label.length === 0 || label.length > MAX_LABEL) return null;
    if (text.length > MAX_VALUE) return null;
    out.push({ label, value: text });
  }
  return out;
}

/**
 * Validates a published table against the cards this build actually has.
 *
 * Returns null when the payload is not a table at all. A payload that is
 * well-formed but contains nothing usable returns an empty map rather than
 * null: "the server says there is nothing to correct" and "the server said
 * something unreadable" are different answers, and only the second is a fault.
 */
export function parseStatLines(payload: unknown, knows: (id: string) => boolean): ParsedStatLines | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { revision, cards } = payload as { revision?: unknown; cards?: unknown };
  if (!isString(revision) || revision.length === 0 || revision.length > 64) return null;
  if (typeof cards !== 'object' || cards === null || Array.isArray(cards)) return null;

  const parsed = new Map<string, readonly StatLine[]>();
  for (const [id, value] of Object.entries(cards as Record<string, unknown>)) {
    // A card this build has never heard of. Dropped rather than kept: the
    // override exists to correct what is on screen, and nothing off-screen can
    // be corrected into existence.
    if (!knows(id)) continue;
    const entries = readEntries(value);
    if (entries) parsed.set(id, entries);
  }
  return { revision, cards: parsed };
}

/** The manifest: small enough that a current build pays almost nothing to ask. */
export interface StatLineManifest {
  readonly revision: string;
  readonly cards: number;
  readonly bytes: number;
}

export function parseManifest(payload: unknown): StatLineManifest | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { revision, cards, bytes } = payload as Record<string, unknown>;
  if (!isString(revision) || revision.length === 0 || revision.length > 64) return null;
  return {
    revision,
    cards: typeof cards === 'number' ? cards : 0,
    bytes: typeof bytes === 'number' ? bytes : 0,
  };
}
