import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/**
 * A staggered entrance that cannot hide the page.
 *
 * Reanimated's entrance animations do not complete under react-native-web in
 * this setup — elements stay at their initial opacity forever, which took down
 * the whole home screen and the whole reveal. React Native's own Animated is
 * well supported on web, so the entrance uses that instead.
 *
 * The rule this encodes: decoration must never gate content. If anything about
 * the animation fails, the content is still on screen.
 */
export function Reveal({
  delay = 0,
  distance = 14,
  duration = 320,
  style,
  children,
  ...rest
}: Omit<ComponentProps<typeof Animated.View>, 'children'> & {
  delay?: number;
  distance?: number;
  duration?: number;
  children: ReactNode;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (cancelled) return;
        if (reduced) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          toValue: 1,
          duration,
          delay,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      })
      .catch(() => progress.setValue(1));

    // Belt and braces: whatever happened above, the content is visible by now.
    const failsafe = setTimeout(() => progress.setValue(1), delay + duration + 600);
    return () => {
      cancelled = true;
      clearTimeout(failsafe);
    };
  }, []);

  return (
    <Animated.View
      {...rest}
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
