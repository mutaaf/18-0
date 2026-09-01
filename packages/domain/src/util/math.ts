/** Deterministic helpers. No Math.random anywhere in the scoring path. */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Rounds to a fixed precision so a rating is stable when it round-trips
 * through JSON, the wire, and the database.
 */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export const RATING_PRECISION = 4;
