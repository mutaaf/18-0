/**
 * 18-0 visual system.
 *
 * The colours and the shape scale moved to `palettes.ts` when the app grew a
 * second identity, and are served from `runtime.ts` as live objects -- see the
 * long note there for why they are mutated rather than reassigned. What is left
 * here is everything that is genuinely fixed across themes: the type stack, the
 * spacing rhythm, the depth helper, and the two colour maps that encode data
 * rather than decoration.
 */

export { color, radius } from './runtime';

/**
 * Position accents. Deliberately restrained metals and one cool tone so the
 * action colour and gold stay the loudest things on screen.
 *
 * Not themed: these identify a position the way a tier letter identifies a
 * tier. A reader who learns that blue means RB should not have to relearn it
 * because they changed the ground.
 */
export const positionColor = {
  QB: '#F2F5FA',
  RB: '#5B9BFF',
  WR: '#3FD68C',
  TE: '#FFB400',
  DEF: '#C49BFF',
} as const;

/**
 * Result tiers. Never the only signal — every use is paired with the tier
 * letter and the ending name (PRFAQ §34). Not themed, for the same reason as
 * the positions above.
 */
export const tierColor: Record<string, string> = {
  F: '#8A93A1',
  D: '#9C9486',
  'C-': '#8E9683',
  C: '#98A08A',
  'C+': '#A3AB93',
  'B-': '#7FA8C9',
  B: '#6FA3D6',
  'B+': '#5B9BE0',
  'A-': '#4DBF8A',
  A: '#3FD68C',
  'A+': '#2FE39A',
  S: '#CE8CF0',
  'S+': '#7FB2FF',
  IMMORTAL: '#FFB400',
};

export const font = {
  display: 'Rajdhani_700Bold',
  displayBlack: 'Rajdhani_700Bold',
  heading: 'Rajdhani_600SemiBold',
  label: 'Rajdhani_600SemiBold',
  body: 'Montserrat_500Medium',
  bodyBold: 'Montserrat_700Bold',
  bodyRegular: 'Montserrat_400Regular',
} as const;

export const space = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
} as const;

/**
 * Depth. React Native ignores `shadow*` on Android, so every raised surface
 * needs an `elevation` alongside it or the app is flat on half its devices.
 */
export const elevate = (level: number) => ({
  elevation: level,
  shadowOffset: { width: 0, height: Math.round(level / 2) },
  shadowRadius: level * 2,
});

/** Scoreboard numerals must not jitter as they change. */
export const tabular = { fontVariant: ['tabular-nums' as const] };

/** Rajdhani is a squarish display face; a little tracking keeps caps legible. */
export const tracking = {
  tight: 0,
  normal: 0.4,
  wide: 1.6,
  wider: 3,
} as const;
