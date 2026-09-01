import { useEffect } from 'react';
import type { ViewStyle } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { ReactNode } from 'react';

/**
 * A short overshoot whenever `trigger` changes — used when a card lands in a
 * roster slot. Small, physical, and gone in under 400ms: the point is to draw
 * the eye to the slot that just changed, not to perform.
 */
export function Pop({
  trigger,
  children,
  style,
  amount = 0.06,
}: {
  trigger: string | number | null | undefined;
  children: ReactNode;
  style?: ViewStyle;
  amount?: number;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (trigger === null || trigger === undefined) return;
    scale.value = withSequence(
      withTiming(1 + amount, { duration: 110, reduceMotion: ReduceMotion.System }),
      withSpring(1, { damping: 11, stiffness: 220, reduceMotion: ReduceMotion.System }),
    );
  }, [trigger]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
