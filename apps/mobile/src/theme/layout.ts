import { useWindowDimensions } from 'react-native';

/**
 * Breakpoints. The game is phone-first, but a desktop window gets a genuinely
 * different composition rather than a stretched phone: the field and the
 * eligible list sit side by side so a pick never costs a scroll.
 */
export const BREAKPOINT = { wide: 900, roomy: 1180 } as const;

export interface Layout {
  readonly width: number;
  /** Two-column gameplay. */
  readonly wide: boolean;
  /** Extra breathing room and larger display type. */
  readonly roomy: boolean;
  /** Max width of the content column. */
  readonly maxWidth: number;
}

export function useLayout(): Layout {
  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT.wide;
  const roomy = width >= BREAKPOINT.roomy;
  return {
    width,
    wide,
    roomy,
    maxWidth: roomy ? 1240 : wide ? 1000 : 560,
  };
}
