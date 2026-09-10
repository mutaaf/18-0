import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/**
 * How wide a box turned out to be, for drawing into.
 *
 * A chart cannot be laid out in percentages: a bar chart needs to divide a real
 * number of points between twenty-five bars, and a line needs real coordinates
 * or its stroke is scaled by whatever `preserveAspectRatio="none"` did to the
 * viewBox -- which is how the first form line came out with a stroke twice as
 * thick at the left of a wide window as at the top.
 *
 * The guard on the setter is the whole reason this is a hook rather than three
 * lines inline. `onLayout` fires on every layout pass, and setting state
 * unconditionally from it is a render loop that only shows up on the platform
 * where the pass happens to be re-entrant.
 */
export function useWidth(): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((prev) => (prev === next ? prev : next));
  }, []);
  return [width, onLayout];
}
