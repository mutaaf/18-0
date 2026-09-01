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

  // Type
  text: '#EEF2F7',
  textDim: '#98A3B3',
  textFaint: '#5C6675',

  // Live action
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
export const positionColor = {
  QB: '#FF4D5E',
  RB: '#4D9DFF',
  WR: '#3FD68C',
  TE: '#FFB03A',
  DEF: '#B47CFF',
} as const;

/**
 * Result tiers never signal by colour alone (PRFAQ §34) — every use is paired
 * with the tier letter and the ending name.
 */
export const tierColor: Record<string, string> = {
  F: '#6B7280',
  D: '#8B7355',
  'C-': '#9A8F6B',
  C: '#A89A6B',
  'C+': '#B5A76B',
  'B-': '#7FA8C9',
  B: '#6FA3D6',
  'B+': '#5B9BE0',
  'A-': '#4DBF8A',
  A: '#3FD68C',
  'A+': '#2FE39A',
  S: '#B47CFF',
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
export const tracking = {
  tight: -1.2,
  normal: 0,
  wide: 1.4,
  wider: 2.6,
} as const;
