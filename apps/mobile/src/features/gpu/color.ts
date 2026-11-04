/**
 * A palette token as the three floats a shader uniform takes.
 *
 * Pure and Skia-free on purpose, so a startup-graph module can prepare
 * uniforms without importing Skia (see `index.tsx`). Alpha in an 8-digit token
 * is dropped: a shader blends with its own alpha, not the token's.
 */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) throw new Error(`not a colour token: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** How far a Duo is bent, 0 flat to 1 at a right angle -- for light, never layout. */
export function bendOf(hinge: { angle: number } | null, folded: boolean): number {
  if (!folded) return 0;
  if (!hinge) return 0.7;
  return Math.min(Math.max((180 - hinge.angle) / 90, 0.35), 1);
}
