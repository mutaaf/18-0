import { useWindowDimensions } from 'react-native';

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
  const { width, height } = useWindowDimensions();
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
