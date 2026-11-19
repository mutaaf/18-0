import { cardById } from '@17-0/data';

/**
 * The card a deep link names, or undefined. `decodeURIComponent` throws on a
 * stray `%` -- `/card/50%` from a hand-typed or truncated link -- and threw
 * during render, so a bad link replaced the screen with the error boundary
 * instead of "that card isn't in the dataset". A repeated param arrives as an
 * array and is read as its first value.
 */
export function cardFromParam(id: string | string[] | undefined) {
  const raw = Array.isArray(id) ? id[0] : id;
  if (!raw) return undefined;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Already decoded, or not decodable: try it as it came.
  }
  return cardById(decoded) ?? cardById(raw);
}
