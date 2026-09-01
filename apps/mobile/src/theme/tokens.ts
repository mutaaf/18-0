/**
 * 18-0 visual system — a night broadcast, not a fantasy spreadsheet.
 *
 * Near-black with a blue cast (a stadium bowl under lights), a single hot red
 * for the live/primary action, and gold reserved exclusively for perfection.
 * Nothing else is allowed to be gold: the first time a player sees it should be
 * the moment they earn it.
 */

export const color = {
  // Ground
  void: '#07090C',
  field: '#0B0F14',
  surface: '#11161D',
  surfaceRaised: '#171E27',
  surfaceHigh: '#1F2833',

  // Structure
  line: '#242D3A',
  lineBright: '#33405180',
  chalk: '#FFFFFF14',

  // Type. `textFaint` carries almost every label in the app at 9-13px, so it
  // has to clear 4.5:1 on the void — #5C6675 measured 3.43:1.
  text: '#EEF2F7',
  textDim: '#98A3B3',
  textFaint: '#7A8496',

  // Live action. `red` is 4.13:1 on the void — a fill colour, not a text
  // colour. Anything under 24px uses `redBright` (5.68:1).
  red: '#E01A2B',
  redBright: '#FF3B4E',
  redGlow: '#E01A2B33',

  // Reserved for 18-0 only
  gold: '#F2C43D',
  goldBright: '#FFDA6B',
  goldGlow: '#F2C43D2E',

  // Heartbreak
  ice: '#7FB2FF',

  positive: '#3FBF7F',
  negative: '#FF6B6B',
} as const;

/** Position accents, used on badges and slot chrome. */
/**
 * Position accents. Quarterback is white-hot rather than red: at #FF4D5E it sat
 * three units from `redBright`, so every QB badge read as "press this" — red
 * has to mean live action and nothing else.
 */
export const positionColor = {
  QB: '#E8EEF6',
  RB: '#6FB0FF',
  WR: '#5FDCA1',
  TE: '#FFC061',
  DEF: '#C49BFF',
} as const;

/**
 * Result tiers never signal by colour alone (PRFAQ §34) — every use is paired
 * with the tier letter and the ending name.
 */
/**
 * Result tiers. The C band used to be three muddy olive-golds, which read as
 * gold — the one colour that must mean 18-0 and nothing else. They are slate
 * now. S is nudged off `positionColor.DEF` so purple does not mean both
 * "defense" and "16-2".
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
  IMMORTAL: '#F2C43D',
};

export const font = {
  display: 'SairaCondensed_800ExtraBold',
  displayBlack: 'SairaCondensed_900Black',
  heading: 'SairaCondensed_700Bold',
  label: 'SairaCondensed_600SemiBold',
  body: 'Barlow_500Medium',
  bodyBold: 'Barlow_700Bold',
  bodyRegular: 'Barlow_400Regular',
} as const;

export const space = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
} as const;

export const radius = {
  sm: 6, md: 10, lg: 14, xl: 20, pill: 999,
} as const;

/** Wide letter-spacing on small caps is the broadcast-lower-third signature. */
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

export const tracking = {
  tight: -1.2,
  normal: 0,
  wide: 1.4,
  wider: 2.6,
} as const;
