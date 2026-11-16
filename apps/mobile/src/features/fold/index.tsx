/**
 * The fold, for screens.
 *
 * `FoldProvider` sits once at the root and gathers what the platform knows: the
 * native sensor on iOS, viewport segments on the web, nothing elsewhere.
 * `useSpread` turns that into the panels one screen may use, measured against
 * where that screen actually sits in the window.
 *
 * The decisions live in `spread.ts`, which is pure and tested against the
 * numbers an iPhone Duo reports. Nothing here decides anything.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { foldSensor, type FoldChange } from '../../../modules/fold';
import { useFlag } from '@/features/flags';
import { SINGLE, computeSpread, navRail, type Division, type Hinge, type Rail, type Rect, type Spread } from './spread';
import { readWebFold, watchWebFold } from './web';

export type { Band, Division, Hinge, Rail, Spread } from './spread';

interface FoldState {
  readonly divisions: readonly Division[];
  readonly hinge: Hinge | null;
}

const EMPTY: FoldState = { divisions: [], hinge: null };
const FoldContext = createContext<FoldState>(EMPTY);

export function FoldProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FoldState>(() => (Platform.OS === 'web' ? readWebFold() : EMPTY));
  const Sensor = foldSensor();

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // Segments are read again on every resize, not cached: a window being
    // dragged across a fold changes them without any fold event of its own.
    return watchWebFold(() => setState(readWebFold()));
  }, []);

  const onFoldChange = useCallback((event: { nativeEvent: FoldChange }) => {
    const { regions, hinge } = event.nativeEvent;
    setState({
      divisions: regions.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height, active: r.active })),
      hinge: hinge ?? null,
    });
  }, []);

  return (
    <FoldContext.Provider value={state}>
      {children}
      {Sensor ? <Sensor style={StyleSheet.absoluteFill} pointerEvents="none" onFoldChange={onFoldChange} /> : null}
    </FoldContext.Provider>
  );
}

/** The raw fold. Most screens want `useSpread` instead. */
export function useFold(): FoldState {
  return useContext(FoldContext);
}

export interface SpreadHandle {
  readonly spread: Spread;
  /** Attach to the container the spread is computed for. */
  readonly ref: React.RefObject<View | null>;
  readonly onLayout: (event: LayoutChangeEvent) => void;
}

/**
 * The panels available to the view `ref` is attached to.
 *
 * Measured in the window rather than from `onLayout` alone, because the fold
 * is in window coordinates and a screen is not: a tab scene sits above the
 * dock, a modal is inset, and a split computed in the wrong space puts the
 * gutter beside the crease instead of on it.
 */
export function useSpread(): SpreadHandle {
  const enabled = useFlag('dual_panel');
  const { divisions } = useFold();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const ref = useRef<View | null>(null);
  const [frame, setFrame] = useState<Rect | null>(null);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      setFrame((prev) =>
        prev && prev.x === x && prev.y === y && prev.width === width && prev.height === height
          ? prev
          : { x, y, width, height },
      );
    });
  }, []);

  // A fold changes the regions without necessarily resizing this view, so
  // the window and the fold both ask for a fresh measurement.
  useEffect(measure, [measure, window.width, window.height, divisions]);

  const spread = useMemo(
    () =>
      enabled && frame
        ? computeSpread({ frame, window, insets, divisions, virtual: true })
        : SINGLE,
    [enabled, frame, window, insets, divisions],
  );

  return { spread, ref, onLayout: measure };
}

/**
 * What a window-wide overlay has to leave out to keep its content on one page
 * of a book-open fold: a modal sheet is centred on the window, and on an iPhone
 * Duo the window's centre is the crease, so the What's New sheet and the
 * report dialog both opened folded down the middle. Zero everywhere else,
 * including a wide browser window's virtual seam -- that is a gutter between
 * panels, not hardware, and a dialog may cross it.
 *
 * The page is the trailing one, beside the rail, unless the leading one is
 * wider. Behind `dual_panel` with the rest of the fold layout.
 */
export function useFoldPage(): { readonly left: number; readonly right: number } {
  const enabled = useFlag('dual_panel');
  const { divisions } = useFold();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(() => {
    const fold = enabled
      ? divisions.find((d) => d.height > d.width && d.x > 0 && d.x + d.width < window.width)
      : undefined;
    if (!fold) return { left: 0, right: 0 };
    // The far edge keeps its safe inset: on a Duo the trailing one is the
    // vertical bar, which a sheet must not run under either.
    const leading = fold.x - insets.left;
    const trailing = window.width - insets.right - (fold.x + fold.width);
    return trailing >= leading
      ? { left: fold.x + fold.width, right: insets.right }
      : { left: insets.left, right: window.width - fold.x };
  }, [enabled, divisions, window.width, insets.left, insets.right]);
}

/**
 * The navigation rail, when the window is showing two pages; null otherwise.
 * See `navRail` in `spread.ts`. Behind `dual_panel` with the rest of the
 * spread, so turning that off restores the bottom dock too.
 */
export function useNavRail(): Rail | null {
  const enabled = useFlag('dual_panel');
  const { divisions } = useFold();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(
    () => (enabled ? navRail({ window, insets, divisions, virtual: true }) : null),
    [enabled, window, insets, divisions],
  );
}
