import { useEffect } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * A slot-machine reel.
 *
 * The spin is the signature moment, so it gets real motion rather than a
 * flicker: a column of candidates travels upward and decelerates onto the
 * result, the way a wheel actually loses momentum. Driven entirely on the UI
 * thread by Reanimated, so it holds frame rate while JavaScript is busy
 * resolving the spin.
 *
 * Reduce Motion cuts straight to the result — the reel is decoration, never
 * the only way to learn what you spun.
 */
export function SpinReel({
  items,
  itemHeight,
  spinning,
  textStyle,
  onSettled,
}: {
  /** Candidates to travel through. The LAST item is the real result. */
  items: readonly string[];
  itemHeight: number;
  spinning: boolean;
  textStyle?: TextStyle;
  onSettled?: () => void;
}) {
  const offset = useSharedValue(0);
  const target = Math.max(0, items.length - 1);

  useEffect(() => {
    if (!spinning) {
      offset.value = target;
      return;
    }
    offset.value = 0;
    offset.value = withTiming(
      target,
      {
        duration: 1150,
        // Heavy deceleration: fast blur, then the last two or three names are
        // readable as it settles. That readability is the whole trick.
        easing: Easing.bezier(0.12, 0.85, 0.2, 1),
        reduceMotion: ReduceMotion.System,
      },
      (finished) => {
        if (finished && onSettled) runOnJS(onSettled)();
      },
    );
  }, [spinning, target, items.length]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -offset.value * itemHeight }],
  }));

  return (
    <View style={[styles.window, { height: itemHeight }]} pointerEvents="none">
      <Animated.View style={style}>
        {items.map((item, index) => (
          <View key={`${item}-${index}`} style={[styles.cell, { height: itemHeight }]}>
            <Text style={[styles.text, textStyle]} numberOfLines={1} adjustsFontSizeToFit>
              {item}
            </Text>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: { overflow: 'hidden', justifyContent: 'flex-start' },
  cell: { justifyContent: 'center' },
  text: { includeFontPadding: false },
});
