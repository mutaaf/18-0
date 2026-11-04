/**
 * The choreography of a celebration, as plain numbers.
 *
 * Pure and Skia-free, so it can be tested and so the per-frame worklet in
 * `effects/fireworks.tsx` only does arithmetic on what is decided here once.
 * Randomness is fine: this is decoration, nowhere near a score.
 *
 * Intensity scales everything, the way the old celebration did: a 10-7 gets a
 * handful of confetti and no shells, a 12-5 one shell, a 15-2 three, a 17-0
 * five, and a perfect season the nine-shell finale.
 */

export interface Confetto {
  x: number;
  y: number;
  vx: number;
  vy: number;
  sway: number;
  freq: number;
  phase: number;
  spin: number;
  flip: number;
  size: number;
  ratio: number;
  delay: number;
  color: number;
}

export interface Shell {
  launch: number;
  rise: number;
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  sparks: number;
  speed: number;
  twist: number;
  life: number;
  color: number;
}

export interface Show {
  confetti: Confetto[];
  shells: Shell[];
  /** Seconds until the last spark has faded and the canvas can stop. */
  duration: number;
}

export function buildShow({
  width,
  height,
  intensity,
  perfect,
  origin,
  colors,
  random = Math.random,
}: {
  width: number;
  height: number;
  intensity: number;
  perfect: boolean;
  /** Where shells launch from: the fold on a Duo, or null for along the bottom. */
  origin: { x: number; y: number } | null;
  colors: number;
  random?: () => number;
}): Show {
  const strength = Math.max(0, Math.min(1, intensity));
  if (strength <= 0 || width <= 0 || height <= 0) return { confetti: [], shells: [], duration: 0 };
  const palette = Math.max(colors, 1);

  const confettiCount = Math.round((perfect ? 320 : 40 + 200 * strength));
  const confetti: Confetto[] = Array.from({ length: confettiCount }, (_, i) => ({
    x: random() * width,
    y: -20 - random() * 140,
    vx: (random() - 0.5) * 70,
    vy: 90 + random() * 150,
    sway: 8 + random() * 26,
    freq: 1.5 + random() * 3,
    phase: random() * Math.PI * 2,
    spin: (random() > 0.5 ? 1 : -1) * (1 + random() * 3),
    flip: 3 + random() * 7,
    size: 6 + random() * (perfect ? 9 : 7),
    ratio: random() > 0.7 ? 1 : 0.45,
    // Front-loaded: a burst, then stragglers.
    delay: random() ** 2 * (1.0 + 1.4 * strength),
    color: i % palette,
  }));

  // One shell for a winning season of 12 or more (the result screen's 0.45):
  // the audience is kids, and a 12-5 is worth a bang.
  const shellCount = perfect ? 9 : strength >= 0.85 ? 5 : strength >= 0.55 ? 3 : strength >= 0.4 ? 1 : 0;
  const shells: Shell[] = Array.from({ length: shellCount }, (_, i) => {
    // From the fold, alternate shells lean onto the left and right pages.
    const side = i % 2 === 0 ? -1 : 1;
    const fromX = origin ? origin.x : width * (0.2 + 0.6 * random());
    const fromY = origin ? Math.min(origin.y, height) : height + 10;
    const x = origin
      ? origin.x + side * width * (0.12 + 0.26 * random())
      : fromX + (random() - 0.5) * width * 0.2;
    return {
      launch: 0.25 + i * (perfect ? 0.42 : 0.55) + random() * 0.2,
      rise: 0.55 + random() * 0.25,
      fromX,
      fromY,
      x: Math.min(Math.max(x, width * 0.08), width * 0.92),
      y: height * (0.14 + 0.3 * random()),
      sparks: perfect ? 64 : 44,
      speed: (perfect ? 170 : 140) + random() * 80,
      twist: random() * Math.PI,
      life: 1.4 + random() * 0.5,
      color: i % palette,
    };
  });

  const lastConfetto = Math.max(0, ...confetti.map((c) => c.delay + fallTime(c, height)));
  const lastShell = Math.max(0, ...shells.map((s) => s.launch + s.rise + s.life));
  return { confetti, shells, duration: Math.min(Math.max(lastConfetto, lastShell) + 0.2, 9) };
}

/** Seconds for a confetto to fall from its start to below the screen. */
function fallTime(c: Confetto, height: number): number {
  const g = 70;
  const distance = height + 30 - c.y;
  // distance = vy t + g t^2 / 2
  return (-c.vy + Math.sqrt(c.vy * c.vy + 2 * g * distance)) / g;
}
