/**
 * The palettes, and the shape each one wears.
 *
 * A theme here is not a light/dark switch. It is a whole visual identity --
 * ground, action colour, structure, and how round everything is -- and the
 * point of having two is that the second one had to prove the tokens were
 * actually tokens. They were not: half the app reached past `color` for a
 * literal `#0A0E17`, which is invisible while there is only one ground and
 * obvious the moment there are two.
 *
 * ---------------------------------------------------------------------------
 * NAMES DESCRIBE ROLE, NEVER HUE
 * ---------------------------------------------------------------------------
 *
 * `action` is the colour of the thing you press. It is red in Broadcast and
 * green in Turf, which is exactly why it cannot be called `red` -- a token
 * named for its colour is a token that can only ever have one, and the day it
 * holds a different one every reader of the code is misled. `gold` survives as
 * a name because it is not a hue here, it is the chase: the crown an earned
 * 18-0 wears is gold in both themes on purpose.
 *
 * ---------------------------------------------------------------------------
 * THE CLUB RULE STILL APPLIES
 * ---------------------------------------------------------------------------
 *
 * No club names, marks, logos or colours (CLAUDE.md). Turf is navy and field
 * green -- the stands and the grass, the two colours every stadium has -- and
 * the green is pulled toward turf rather than the brighter action green a
 * particular north-western club is known for. Franchise palettes are still
 * generated per franchise and are not affected by any of this.
 */

/**
 * Every colour the app is allowed to know about.
 *
 * Adding a key here is cheap; reaching past it for a literal is what costs.
 * The one exception the codebase keeps is white-alpha overlays (`#FFFFFF0A`
 * and friends) -- they are a lighting effect rather than a colour, and they
 * read correctly on any dark ground, so both palettes leave them alone.
 */
export interface Palette {
  // Ground, deepest first.
  void: string;
  field: string;
  surface: string;
  surfaceRaised: string;
  surfaceHigh: string;
  navy: string;
  navyDeep: string;

  /** Opaque grounds for things that sit *over* the page: sheets, discs, pills. */
  ink: string;
  inkDeep: string;
  /** The same, translucent: scrims behind a floating bar or a modal. */
  scrim: string;
  glass: string;

  /** Panel gradient. Top is lit, bottom is not. */
  panelTop: string;
  panelBottom: string;

  /** The stadium backdrop's three light sources. */
  backdropCool: string;
  backdropWarm: string;
  backdropFloor: string;

  // Structure
  line: string;
  lineBright: string;
  lineGold: string;
  chalk: string;

  // Type
  text: string;
  silver: string;
  textDim: string;
  textFaint: string;
  /** Type that sits *on* the action colour. Nearly black on green, white on red. */
  onAction: string;

  /** The thing you press, and anything live. */
  action: string;
  actionBright: string;
  /** The shaded end of the action colour, for a lit tile or a pressed face. */
  actionDeep: string;
  actionGlow: string;

  /** The chase. Gold in both themes -- see the note above. */
  gold: string;
  goldBright: string;
  goldDeep: string;
  goldGlow: string;

  /** A secondary heat, never a primary. */
  ignition: string;
  ignitionBright: string;
  ignitionGlow: string;

  /** Heartbreak stays cold against all that heat. */
  ice: string;

  positive: string;
  negative: string;
}

/**
 * How round things are.
 *
 * Shape carries as much identity as colour: Broadcast is a hard-edged
 * scoreboard, Turf is a soft stack of pills. Both are the same components.
 */
export interface Shape {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
}

export interface Theme {
  id: ThemeId;
  /** What it is called in the picker. */
  name: string;
  /** One line, shown under the name. */
  note: string;
  color: Palette;
  radius: Shape;
}

export type ThemeId = 'broadcast' | 'turf';

/**
 * Broadcast — the original.
 *
 * A navy-black bowl, red for anything live, silver type. Reconciled from three
 * sources: the league's broadcast navy #013369 and red #D50A0A, ESPN's dense
 * uppercase bars, and 18-0's own Victory Gold #FFB400 and Steel Silver
 * #C0C0C6.
 */
const broadcast: Theme = {
  id: 'broadcast',
  name: 'Broadcast',
  note: 'Night game. Navy-black, live red, silver type.',
  color: {
    void: '#06080F',
    field: '#090C16',
    surface: '#0E1220',
    surfaceRaised: '#141A2B',
    surfaceHigh: '#1C2437',
    navy: '#013369',
    navyDeep: '#011E3F',

    ink: '#0A0E17',
    inkDeep: '#05070C',
    scrim: '#0A0E1799',
    glass: '#080B0FF2',

    panelTop: '#1A2233',
    panelBottom: '#080B12',

    backdropCool: '#2D6BB5',
    backdropWarm: '#8E1620',
    backdropFloor: '#013369',

    line: '#222C42',
    lineBright: '#31405F',
    lineGold: '#FFB40033',
    chalk: '#FFFFFF12',

    text: '#F2F5FA',
    silver: '#C0C0C6',
    textDim: '#9AA4B8',
    textFaint: '#7C8699',
    onAction: '#FFFFFF',

    action: '#D50A0A',
    actionBright: '#FF2B2B',
    actionDeep: '#6B0202',
    actionGlow: '#D50A0A33',

    gold: '#FFB400',
    goldBright: '#FFD152',
    goldDeep: '#C98A00',
    goldGlow: '#FFB40033',

    ignition: '#FF6A00',
    ignitionBright: '#FF8A33',
    ignitionGlow: '#FF6A0033',

    ice: '#7FB2FF',
    positive: '#3FD68C',
    negative: '#FF6B6B',
  },
  radius: { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 },
};

/**
 * Turf — daylight, and a green button.
 *
 * A saturated navy ground rather than a black one, field green for every
 * action, and a much rounder shape language: the primary control is a filled
 * pill and the secondaries are outlines of the same pill, so a stack of
 * choices reads as a stack rather than as a wall of cards.
 *
 * The ground is deliberately *lighter* than Broadcast's. That is the whole
 * difference in feel: Broadcast is a stadium at night with the lights blowing
 * out the corners, Turf is a one o'clock kickoff.
 *
 * `onAction` is near-black here, not white. White on #5FBB46 is about 2.4:1
 * and fails every contrast bar there is; the near-black is 8.9:1. This is the
 * token that exists purely because the two themes disagree about it.
 */
const turf: Theme = {
  id: 'turf',
  name: 'Turf',
  note: 'One o’clock kickoff. Deep navy, field green, soft pills.',
  color: {
    void: '#070E3A',
    field: '#0A1449',
    surface: '#101C63',
    surfaceRaised: '#16247A',
    surfaceHigh: '#1D2E90',
    navy: '#1B2E9C',
    navyDeep: '#0A1449',

    ink: '#0B1452',
    inkDeep: '#050A2B',
    scrim: '#070E3ACC',
    glass: '#0A1449F2',

    panelTop: '#1A2A85',
    panelBottom: '#0A1449',

    backdropCool: '#3D5BE0',
    backdropWarm: '#5FBB46',
    backdropFloor: '#1B2E9C',

    line: '#2B3E9E',
    lineBright: '#4055C4',
    lineGold: '#FFB40040',
    chalk: '#FFFFFF1A',

    text: '#FFFFFF',
    silver: '#C8D2F0',
    textDim: '#9BA9DA',
    textFaint: '#7C8CC4',
    onAction: '#06210A',

    action: '#5FBB46',
    actionBright: '#7BD35F',
    actionDeep: '#2C6B1F',
    actionGlow: '#5FBB4633',

    gold: '#FFC531',
    goldBright: '#FFDA6B',
    goldDeep: '#D99A00',
    goldGlow: '#FFC53133',

    ignition: '#FF8A3D',
    ignitionBright: '#FFA766',
    ignitionGlow: '#FF8A3D33',

    ice: '#9CC6FF',
    positive: '#7BD35F',
    negative: '#FF7B7B',
  },
  // Rounder across the board, and the jump from lg to xl is bigger: the
  // reference stacks big soft pills, and a 14pt corner on a 56pt button is
  // the thing that makes it read as a card instead.
  radius: { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 },
};

export const THEMES: Record<ThemeId, Theme> = { broadcast, turf };

/** The order the picker shows them in. The shipped default leads. */
export const THEME_LIST: readonly Theme[] = [turf, broadcast];

/**
 * What the app is, before anybody chooses.
 *
 * Turf. Broadcast was first and is the more restrained of the two, but a game
 * about chasing an undefeated season should not open looking like a results
 * service -- the navy ground and the green button read as an invitation, and the
 * black one reads as a scoreboard. The palette that ships is the one that sets
 * the expectation.
 *
 * Moving this moves what an un-configured device shows, what `useThemeFlagGuard`
 * puts somebody back to when the picker is switched off, and what the PWA paints
 * before React mounts -- `public/index.html` and `manifest.webmanifest` carry
 * the same colour and have to move with it.
 */
export const DEFAULT_THEME: ThemeId = 'turf';

export function isThemeId(value: unknown): value is ThemeId {
  return value === 'broadcast' || value === 'turf';
}
