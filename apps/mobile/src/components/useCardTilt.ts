import { useRef } from 'react';
import { Animated, PanResponder } from 'react-native';

/**
 * Turns a card under the finger, and slides a highlight across it.
 *
 * Shared by the player card and the manager card so the two behave alike: the
 * whole point is that everything in this game reads as the same kind of
 * object, and two hand-rolled tilts would drift apart the first time either
 * was adjusted.
 *
 * Eight degrees. Enough to say the surface has depth, not enough to be a toy.
 */
export function useCardTilt({ degrees = 8, sheenTravel = 160 } = {}) {
  const tilt = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const responder = useRef(
    PanResponder.create({
      // Only claim the gesture once it is clearly a drag. A tap still reaches
      // whatever is underneath, and a vertical scroll is not stolen from the
      // list this card sits in.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
      onPanResponderMove: (_e, g) => {
        tilt.setValue({
          x: Math.max(-1, Math.min(1, g.dx / 140)),
          y: Math.max(-1, Math.min(1, g.dy / 180)),
        });
      },
      onPanResponderRelease: () => {
        // Springs rather than snaps, which is what makes it read as a physical
        // thing being let go of.
        Animated.spring(tilt, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: true,
          friction: 5,
          tension: 40,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(tilt, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: true,
          friction: 5,
          tension: 40,
        }).start();
      },
    }),
  ).current;

  return {
    panHandlers: responder.panHandlers,
    transform: [
      { perspective: 900 },
      {
        rotateX: tilt.y.interpolate({
          inputRange: [-1, 1],
          outputRange: [`${degrees}deg`, `-${degrees}deg`],
        }),
      },
      {
        rotateY: tilt.x.interpolate({
          inputRange: [-1, 1],
          outputRange: [`-${degrees}deg`, `${degrees}deg`],
        }),
      },
    ],
    /** The highlight travels further than the card turns, so it reads as a reflection. */
    sheenShift: tilt.x.interpolate({
      inputRange: [-1, 1],
      outputRange: [-sheenTravel, sheenTravel],
    }),
  };
}
