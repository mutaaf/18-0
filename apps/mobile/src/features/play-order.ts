/**
 * The order of a spin's player list (app/play.tsx).
 *
 * The players who can still go somewhere come first, the ones whose position
 * is already full after them. Ordered by position alone, every spin after the
 * defence and the quarterback were picked opened on a screenful of greyed-out
 * DEF and QB rows, and the first pick you could make was below the fold -- a
 * scroll on most spins (scripts/perf/phone/journeys.mjs).
 *
 * Stable, and keyed only on which positions are open, which the field already
 * shows: it says nothing about a rating, so it is safe in the modes that hide
 * one.
 */
export function fitsFirst<T extends { position: string }>(rows: readonly T[], open: ReadonlySet<string>): T[] {
  const fit: T[] = [];
  const full: T[] = [];
  for (const row of rows) (open.has(row.position) ? fit : full).push(row);
  return fit.concat(full);
}
