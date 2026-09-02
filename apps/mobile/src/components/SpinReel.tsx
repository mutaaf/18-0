import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { DECORATIVE } from '@/theme';

/**
 * A slot-machine reel.
 *
 * The spin is the signature moment, so it gets real motion rather than a
 * flicker: a column of candidates travels upward and decelerates onto the
 * result, the way a wheel actually loses momentum.
 *
 * Uses React Native's own Animated rather than Reanimated — Reanimated's
 * completion callbacks do not fire under react-native-web here, and this reel
 * used to be what told the screen the spin had finished. When that callback
 * never came, the eligible list stayed hidden forever. The caller now owns that
 * timing anyway, but the same reasoning applies to the animation itself.
 *
 * Reduce Motion cuts straight to the result: the reel is decoration, never the
 * only way to learn what you spun.
 */
export function SpinReel({
  items,
  itemHeight,
  spinning,
  textStyle,
  duration = 1150,
}: {
  /** Candidates to travel through. The LAST item is the real result. */
  items: readonly string[];
  itemHeight: number;
  spinning: boolean;
  textStyle?: TextStyle;
  duration?: number;
}) {
  const target = Math.max(0, items.length - 1);
  const offset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!spinning) {
      offset.setValue(target);
      return;
    }
    offset.setValue(0);
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (reduced) {
          offset.setValue(target);
          return;
        }
        Animated.timing(offset, {
          toValue: target,
          duration,
          // Heavy deceleration: a fast blur, then the last two or three names
          // are readable as it settles. That readability is the whole trick.
          easing: Easing.bezier(0.12, 0.85, 0.2, 1),
          useNativeDriver: true,
        }).start();
      })
      .catch(() => offset.setValue(target));
  }, [spinning, target]);

  return (
    <View
      style={[styles.window, { height: itemHeight }]}
      pointerEvents="none"
      {...DECORATIVE}
    >
      <Animated.View
        style={{
          transform: [
            {
              translateY: offset.interpolate({
                inputRange: [0, Math.max(1, target)],
                outputRange: [0, -target * itemHeight],
              }),
            },
          ],
        }}
      >
        {items.map((item, index) => (
          <View key={`${item}-${index}`} style={[styles.cell, { height: itemHeight }]}>
            <Text style={[styles.text, textStyle]} numberOfLines={1}>
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
