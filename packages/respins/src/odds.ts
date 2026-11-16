/**
 * The wheel's odds, as the server actually draws them.
 *
 * A normal spin (supabase/functions/spin) takes every card that could still
 * fill an open slot, collapses them to their distinct franchise-eras, and picks
 * one of those uniformly. Not weighted by how many cards a bucket holds, not by
 * `franchise_eras.spin_weight` (which nothing reads), not by rating. So "1 in N"
 * is literally true, where N is the number of franchise-eras still open to you.
 *
 * A respin draws with the same function, from the same candidates, with one
 * difference: the franchise-era it replaces is left out. Drawing it again would
 * charge a player for nothing, and a paid draw that can land where it started
 * is a paid draw whose odds are harder to state honestly.
 *
 * The purchase sheet states these odds (App Store Review Guideline 3.1.1 asks
 * an app offering a randomized paid item to disclose them before purchase),
 * and `oddsDisclosure` is the only place that sentence is written.
 */

export interface Bucket {
  readonly franchiseId: string;
  readonly era: string;
}

export const bucketKey = (b: Bucket): string => `${b.franchiseId}:${b.era}`;

/** Distinct franchise-eras, first occurrence kept, order preserved. */
export function distinctBuckets<T extends Bucket>(candidates: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of candidates) {
    const key = bucketKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * One franchise-era, uniformly, from those not excluded.
 *
 * `random` is injected so the tests can drive it; both functions pass
 * `Math.random`. Returns null when nothing is left to draw.
 */
export function drawUniform<T extends Bucket>(
  buckets: readonly T[],
  exclude: readonly Bucket[] = [],
  random: () => number = Math.random,
): T | null {
  const skip = new Set(exclude.map(bucketKey));
  const pool = skip.size === 0 ? buckets : buckets.filter((b) => !skip.has(bucketKey(b)));
  if (pool.length === 0) return null;
  // `random()` is in [0, 1); the clamp is for a test double that returns 1.
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index]!;
}

/**
 * The sentence the purchase sheet shows.
 *
 * `open` is how many franchise-eras could fill an open slot right now,
 * including the one that just landed; null when the sheet is opened away from
 * a spin and there is no "right now" to count.
 */
export function oddsDisclosure(open: number | null): string {
  const rule =
    'A respin draws a new franchise-era for the same turn. Every franchise-era that can still fill one of your open slots, ' +
    'other than the one you are replacing, is equally likely.';
  if (open === null || open < 2) return rule;
  const n = open - 1;
  return `${rule} Right now that is ${n.toLocaleString('en-US')}, so each is 1 in ${n.toLocaleString('en-US')}.`;
}
