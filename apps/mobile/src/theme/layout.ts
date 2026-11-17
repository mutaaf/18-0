import { useWindowDimensions } from 'react-native';
import { isTV } from '@/features/tv/platform';

/**
 * How much bigger everything is drawn on a television.
 *
 * The screens are sized in phone points: 14-point labels, 48-point buttons. An
 * Apple TV is 1920 x 1080 points watched from across a room, where that is
 * about a third of the size Apple's own type uses. Rather than a second set of
 * sizes in five hundred stylesheets, the whole app is laid out on a 1280 x 720
 * stage and the stage is scaled by this to fill the screen (`TVStage`), so the
 * TV gets the desktop composition that already exists -- two columns, the
 * field beside the list -- at a size you can read from the sofa.
 *
 * Every window measurement goes through `useWindowSize` below, which reports
 * the stage, never the glass; a component that asked React Native directly
 * would lay itself out half again too wide. `native-imports.test.ts` keeps
 * this the only file that does.
 */
export const TV_SCALE = isTV ? 1.5 : 1;

/**
 * The TV-safe margins, in stage points: Apple's tvOS safe area (80 points at
 * the sides and 60 at the top and bottom of the 1920 x 1080 screen), divided
 * by the scale. A television may crop the edges of its picture, so nothing
 * that matters is drawn outside these. Backgrounds still run to the edge;
 * `TVSafeArea` hands these to every safe-area consumer as the insets, the way
 * a notch's are handed to them on a phone.
 */
export const TV_SAFE = isTV ? { x: 80 / TV_SCALE, y: 60 / TV_SCALE } : { x: 0, y: 0 };

/**
 * A `measureInWindow` result, in stage points. The measurement is taken on the
 * glass, after the stage's transform; the stage is scaled from the top-left
 * corner, so dividing by the scale is the whole conversion.
 */
export function toStage(x: number, y: number, width: number, height: number) {
  return { x: x / TV_SCALE, y: y / TV_SCALE, width: width / TV_SCALE, height: height / TV_SCALE };
}

/** The window, in the points the app lays out in: the stage on a TV. */
export function useWindowSize(): { width: number; height: number; scale: number; fontScale: number } {
  const window = useWindowDimensions();
  if (TV_SCALE === 1) return window;
  return { ...window, width: window.width / TV_SCALE, height: window.height / TV_SCALE };
}

/**
 * Breakpoints. The game is phone-first, but a desktop window gets a genuinely
 * different composition rather than a stretched phone: the field and the
 * eligible list sit side by side so a pick never costs a scroll.
 */
export const BREAKPOINT = { wide: 900, roomy: 1180 } as const;

/**
 * Below this the screen has no height to spend on anything that is not the
 * lineup or the list. It is not a device: the shortest viewport the game runs
 * in is the 620-point frame the extension gives `/embed`, and the smallest
 * phone sits just above it — both need the same composition, and neither can
 * afford the flavour a 6.3-inch phone has room for.
 */
export const SHORT_VIEWPORT = 700;

export interface Layout {
  readonly width: number;
  readonly height: number;
  /** Two-column gameplay. */
  readonly wide: boolean;
  /** Extra breathing room and larger display type. */
  readonly roomy: boolean;
  /** Not enough vertical room for anything optional. */
  readonly short: boolean;
  /** Max width of the content column. */
  readonly maxWidth: number;
}

export function useLayout(): Layout {
  const { width, height } = useWindowSize();
  const wide = width >= BREAKPOINT.wide;
  const roomy = width >= BREAKPOINT.roomy;
  return {
    width,
    height,
    wide,
    roomy,
    short: height < SHORT_VIEWPORT,
    maxWidth: roomy ? 1240 : wide ? 1000 : 560,
  };
}
