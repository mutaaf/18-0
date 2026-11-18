import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/**
 * Reduce Motion, asked once for the app and kept current, rather than once
 * per Reveal. A spin's list is a hundred of them, and each was a round trip
 * to the native side before its row could start moving.
 */
let reduced: boolean | null = null;
let asking: Promise<boolean> | null = null;
function reduceMotion(): Promise<boolean> {
  if (reduced !== null) return Promise.resolve(reduced);
  if (!asking) {
    asking = AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduced = on));
    AccessibilityInfo.addEventListener('reduceMotionChanged', (on: boolean) => {
      reduced = on;
    });
    // A failed query is asked again next time rather than remembered.
    asking.catch(() => (asking = null));
  }
  return asking;
}

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
 *
 * `immediate` mounts it already in place, with no clock, timer or query: for
 * an entrance nobody would see (a row below the fold) and for one UIKit must
 * not wait for -- tvOS refuses `hasTVPreferredFocus` to a view still at
 * opacity 0, and the remote lands somewhere else.
 */
export function Reveal({
  delay = 0,
  distance = 14,
  duration = 320,
  immediate = false,
  style,
  children,
  ...rest
}: Omit<ComponentProps<typeof Animated.View>, 'children'> & {
  delay?: number;
  distance?: number;
  duration?: number;
  /** Already in place: read at mount only. */
  immediate?: boolean;
  children: ReactNode;
}) {
  const progress = useRef(new Animated.Value(immediate ? 1 : 0)).current;

  useEffect(() => {
    if (immediate) return;
    let cancelled = false;
    reduceMotion()
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
