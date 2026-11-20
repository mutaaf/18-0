/**
 * The stadium lights' choreography (`lights.tsx`), as data: what plays at each
 * moment and when. Free of React Native so `performance.test.ts` can hold the
 * budget -- layers per show, how long a show runs, the strobe rate -- against
 * the real plans rather than a copy of them.
 */
export type LightShow = 'spin' | 'pick' | 'reveal' | 'perfect';

export interface Beam {
  /** Where the lamp hangs, as a fraction of the width. */
  readonly x: number;
  /** Degrees from straight down; positive swings the beam's far end left. */
  readonly from: number;
  readonly to: number;
  readonly rest: number;
  /** Milliseconds from the moment the show is cued for (may be negative: a beam leads in). */
  readonly delay: number;
  readonly sweep: number;
  /** Tinted with the show's colour rather than white light. */
  readonly tinted: boolean;
}

export interface Bulb {
  readonly x: number;
  readonly y: number;
  readonly delay: number;
}

export interface LightPlan {
  readonly beams: readonly Beam[];
  /** Each a full wash pulse, ms from the moment. */
  readonly wash: readonly number[];
  readonly washPeak: number;
  readonly bulbs: readonly Bulb[];
  /** A second pop for every bulb, this long after its first. 0 for none. */
  readonly repop: number;
  /** When, from the moment, everything has faded and the show unmounts. */
  readonly tail: number;
}

const pair = (x: number, from: number, to: number, rest: number, delay: number, sweep: number, tinted: boolean): Beam[] => [
  { x, from: -from, to: -to, rest: -rest, delay, sweep, tinted },
  { x: 1 - x, from, to, rest, delay, sweep, tinted },
];

/** Exported for the budget test: the plan is the whole show. */
export const PLANS: Record<LightShow, LightPlan> = {
  // The wheel answers: two searchlights cross over the hero and settle on it.
  spin: {
    beams: pair(0.1, 64, 4, 26, 0, 720, false),
    wash: [420],
    washPeak: 0.7,
    bulbs: [
      { x: 0.24, y: 0.1, delay: 220 },
      { x: 0.71, y: 0.07, delay: 480 },
      { x: 0.47, y: 0.18, delay: 760 },
    ],
    repop: 0,
    tail: 2300,
  },
  // A pick locks in: a quicker, smaller nod.
  pick: {
    beams: pair(0.14, 42, 14, 20, 0, 420, true),
    wash: [],
    washPeak: 0,
    bulbs: [
      { x: 0.3, y: 0.12, delay: 140 },
      { x: 0.66, y: 0.09, delay: 400 },
    ],
    repop: 0,
    tail: 1500,
  },
  // The record: four beams lead in and land on it as it slams down.
  reveal: {
    beams: [...pair(0.05, 70, 30, 36, -1150, 1000, false), ...pair(0.3, 44, -10, 12, -950, 900, true)],
    wash: [0],
    washPeak: 0.8,
    bulbs: [
      { x: 0.2, y: 0.14, delay: 40 },
      { x: 0.8, y: 0.1, delay: 200 },
      { x: 0.52, y: 0.06, delay: 380 },
    ],
    repop: 0,
    tail: 4200,
  },
  // 17-0: the same rig, in gold, with the strobe and a second round of bulbs.
  perfect: {
    beams: [...pair(0.05, 70, 30, 36, -1150, 1000, true), ...pair(0.3, 44, -10, 12, -950, 900, false)],
    wash: [0, 450, 900],
    washPeak: 0.85,
    bulbs: [
      { x: 0.2, y: 0.14, delay: 40 },
      { x: 0.8, y: 0.1, delay: 200 },
      { x: 0.52, y: 0.06, delay: 380 },
    ],
    repop: 620,
    tail: 5400,
  },
};

/**
 * The play screen's standing lights (`RestingLights` in lights.tsx): lamps
 * that stay lit for as long as the screen is up, rather than a show that
 * plays and goes. Each is a beam like a show's, resting at an angle; a spin
 * landing or a pick locking in flares it and swings it by `swing`, and it
 * comes back to rest. Nothing moves between moments.
 */
export interface RestingBeam {
  readonly x: number;
  /** Degrees from straight down; positive swings the far end left. */
  readonly rest: number;
  /** How far a moment swings it before it settles back. */
  readonly swing: number;
  readonly tinted: boolean;
}

export const RESTING_BEAMS: readonly RestingBeam[] = [
  // From the top left, down across the field.
  { x: 0.1, rest: -14, swing: 10, tinted: false },
  // From the top right, across the spin's hero and the list.
  { x: 0.9, rest: 24, swing: -12, tinted: false },
];

/** A pool where the left beam lands on the field: lit, never moving. */
export const RESTING_POOL = { x: 0.27, y: 0.6, w: 0.46, h: 0.56 } as const;

/** How bright the standing beams are at rest and at the top of a flare. */
export const RESTING_ALPHA = 0.62;
export const RESTING_FLARE = 0.9;
