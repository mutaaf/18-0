/**
 * 18-0 visual system.
 *
 * Three sources, reconciled deliberately:
 *
 *   Ground    Navy #013369 and red #D50A0A — a broadcast palette, not a club's.
 *   ESPN      Dense red header bars, hard uppercase labels, ticker rhythm.
 *   18-0      Victory Gold #FFB400, Steel Silver #C0C0C6 from the brand sheet.
 *
 * So the chrome is a broadcast: a navy-black bowl, red for anything live, and
 * silver type. Gold is not chrome — it is the colour of the chase, and the
 * crown that wears it is reserved for an earned 18-0.
 */

export const color = {
  // Ground — black with navy in it rather than neutral grey.
  void: '#06080F',
  field: '#090C16',
  surface: '#0E1220',
  surfaceRaised: '#141A2B',
  surfaceHigh: '#1C2437',
  navy: '#013369',
  navyDeep: '#011E3F',

  // Structure
  line: '#222C42',
  lineBright: '#31405F',
  lineGold: '#FFB40033',
  chalk: '#FFFFFF12',

  // Type — silver is the brand's body metal, not plain white.
  text: '#F2F5FA',
  silver: '#C0C0C6',
  textDim: '#9AA4B8',
  textFaint: '#7C8699',

  // Live action — broadcast red, with a hotter red for small type.
  red: '#D50A0A',
  redBright: '#FF2B2B',
  redGlow: '#D50A0A33',

  // The chase
  gold: '#FFB400',
  goldBright: '#FFD152',
  goldDeep: '#C98A00',
  goldGlow: '#FFB40033',

  // Kept as a secondary heat, not a primary.
  ignition: '#FF6A00',
  ignitionBright: '#FF8A33',
  ignitionGlow: '#FF6A0033',

  // Heartbreak stays cold against all that heat.
  ice: '#7FB2FF',

  positive: '#3FD68C',
  negative: '#FF6B6B',
} as const;

/**
 * Position accents. Deliberately restrained metals and one cool tone so gold
 * and orange stay the loudest things on screen.
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
 * letter and the ending name (PRFAQ §34).
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

export const radius = {
  sm: 6, md: 10, lg: 14, xl: 20, pill: 999,
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
