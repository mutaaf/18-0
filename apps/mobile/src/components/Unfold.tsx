import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

const DURATION = 220;

/**
 * A line that opens its own room instead of appearing in it.
 *
 * The play screen's notices -- a refused spin, "Locked in", the assisted flag
 * -- used to mount at full height in one frame, so everything under them (the
 * field, the first row of players) jumped down by a line of text at the moment
 * the player was looking at it, and jumped back up when the next spin cleared
 * it. This grows the space from nothing and gives it back the same way, and
 * keeps the last content on screen while it closes so a leave is a fold, not a
 * blink.
 *
 * `gap` is the parent's own `gap`: a zero-height child still costs its parent
 * one gap, so without it the line would still arrive with a 12-point jump.
 *
 * Built on React Native's `Animated` (JS-driven: height cannot be native-driven)
 * rather than a Reanimated layout transition, which does not complete under
 * react-native-web here (see `Reveal`). Same rule as there: a failsafe puts the
 * content at its end state whatever the driver did, so decoration cannot hide a
 * notice the player needs to read.
 */
export function Unfold({ children, gap = 0 }: { children: ReactNode; gap?: number }) {
  const reduced = useReducedMotion();
  const open = children !== null && children !== undefined && children !== false;
  const held = useRef<ReactNode>(null);
  if (open) held.current = children;

  const [present, setPresent] = useState(open);
  const [height, setHeight] = useState(0);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    if (open) setPresent(true);
    const target = open ? 1 : 0;
    const done = () => {
      progress.setValue(target);
      if (!open) {
        held.current = null;
        setPresent(false);
      }
    };
    if (reduced) {
      done();
      return;
    }
    let live = true;
    const run = Animated.timing(progress, {
      toValue: target,
      duration: DURATION,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: false,
    });
    run.start(({ finished }) => {
      if (finished && live) done();
    });
    const failsafe = setTimeout(() => live && done(), DURATION + 400);
    return () => {
      live = false;
      run.stop();
      clearTimeout(failsafe);
    };
  }, [open, reduced, progress]);

  if (!open && !present) return null;
  return (
    <Animated.View
      style={{
        overflow: 'hidden',
        height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] }),
        marginTop: progress.interpolate({ inputRange: [0, 1], outputRange: [-gap, 0] }),
        opacity: progress,
      }}
    >
      {/* Measured off-flow, so the room can be sized to it before it is given. */}
      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      >
        {open ? children : held.current}
      </View>
    </Animated.View>
  );
}
