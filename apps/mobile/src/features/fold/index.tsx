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
import { SINGLE, computeSpread, type Division, type Hinge, type Rect, type Spread } from './spread';
import { readWebFold, watchWebFold } from './web';

export type { Band, Division, Hinge, Spread } from './spread';

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
