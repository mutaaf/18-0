import { Fragment, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { DockIcon, type DockIconName } from './DockIcons';
import { useHasHover } from './useHasHover';
import { color, elevate, font, radius, space, tracking } from '@/theme';

/**
 * A dock, for screens wide enough to have somewhere to put one.
 *
 * The desktop layout used a 208-pixel rail down the left, which took a fifth of
 * a laptop screen away from the thing the app is actually for and made the
 * widest layout the one with the least room for a football field.
 *
 * This is the other arrangement: the navigation floats at the bottom, over the
 * content, and gets out of the way. It magnifies under the pointer the way a
 * dock does -- the item beneath the cursor grows, its neighbours grow less, and
 * the falloff is what makes it feel like a physical row rather than five
 * buttons that change size.
 *
 * Magnification is a pointer affordance and there is no pointer on a tablet, so
 * touch gets the same dock without it: the tile still swells while held, the
 * active one still stands out, and nothing depends on hovering.
 */

/** How far the swell reaches, in neighbours. */
const REACH = 2;
const BASE = 42;
const PEAK = 70;

export interface DockItemSpec {
  key: string;
  label: string;
  /** The one-word form, for the standing labels a touch screen gets. */
  short: string;
  icon: DockIconName;
  /** Put a separator to the left of this tile. */
  dividerBefore?: boolean;
}

export function Dock({
  items,
  activeIndex,
  onSelect,
}: {
  items: DockItemSpec[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const [focus, setFocus] = useState<number | null>(null);
  const hasHover = useHasHover();

  const named = focus === null ? null : items[focus];

  return (
    <View style={styles.stage} pointerEvents="box-none">
      {/* Reserved whether or not anything is hovered, so naming a tile does not
          shove the dock down the screen. Never on touch, where the labels are
          standing under the tiles instead. */}
      {hasHover ? (
        <View style={styles.tipRow} pointerEvents="none">
          {named ? (
            <View style={styles.tip}>
              <Text style={styles.tipText}>{named.label}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={[styles.dock, GLASS, elevate(10)]}>
        {/* The lit top edge every piece of glass has. */}
        <View style={styles.glassEdge} pointerEvents="none" />
        {items.map((item, index) => (
          <Fragment key={item.key}>
            {/* A dock separates the apps from the things that are yours. */}
            {item.dividerBefore ? <View style={styles.divider} /> : null}
            <DockTile
              item={item}
              index={index}
              focus={focus}
              active={index === activeIndex}
              labelled={!hasHover}
              onHover={setFocus}
              onPress={() => onSelect(index)}
            />
          </Fragment>
        ))}
      </View>
    </View>
  );
}

function DockTile({
  item,
  index,
  focus,
  active,
  labelled,
  onHover,
  onPress,
}: {
  item: DockItemSpec;
  index: number;
  focus: number | null;
  active: boolean;
  /** Draw the name under the tile, for devices with no pointer to hover. */
  labelled: boolean;
  onHover: (index: number | null) => void;
  onPress: () => void;
}) {
  const [held, setHeld] = useState(false);

  // Distance from the pointer decides the swell. Squared falloff, so the tile
  // under the cursor is clearly the one being pointed at and its neighbours
  // only lean towards it.
  const distance = focus === null ? REACH + 1 : Math.abs(index - focus);
  const pointed = Math.max(0, 1 - (distance / (REACH + 1)) ** 2);
  // A held tile behaves like a pointed one, which is the whole magnification
  // affordance a touch screen can have.
  const target = Math.max(pointed, held ? 1 : 0);

  const swell = useRef(new Animated.Value(0)).current;

  // In an effect, not in render: starting an animation during render updates
  // the animated node mid-render, which React reports as updating one
  // component while rendering another.
  useEffect(() => {
    Animated.spring(swell, {
      toValue: target,
      // One value drives width, lift and scale together, so it has to run on
      // the JS driver -- width is layout, and layout is not native-drivable.
      useNativeDriver: false,
      friction: 8,
      tension: 130,
    }).start();
  }, [target, swell]);

  const box = swell.interpolate({ inputRange: [0, 1], outputRange: [BASE, PEAK] });
  const lift = swell.interpolate({ inputRange: [0, 1], outputRange: [0, -(PEAK - BASE) * 0.4] });
  const scale = swell.interpolate({ inputRange: [0, 1], outputRange: [1, PEAK / BASE] });

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => onHover(index)}
      onHoverOut={() => onHover(null)}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.label}
      style={styles.slot}
    >
      <Animated.View
        style={[styles.tile, { width: box, height: box, transform: [{ translateY: lift }] }]}
      >
        {/* The icon is drawn once at its resting size and scaled, so it stays
            a vector at every step of the swell instead of being re-laid out. */}
        <Animated.View style={{ transform: [{ scale }] }}>
          <DockIcon name={item.icon} size={BASE} />
        </Animated.View>
      </Animated.View>

      {labelled ? (
        <Text style={[styles.standing, active && styles.standingOn]} numberOfLines={1}>
          {item.short}
        </Text>
      ) : (
        /* Running-app dot. The one piece of a real dock worth keeping
           literally: it says where you are without spending a label on it. */
        <View style={[styles.dot, active && styles.dotOn]} />
      )}
    </Pressable>
  );
}

/**
 * Glass, where the platform has it.
 *
 * A solid slab across the bottom is a second navigation bar; the point of a
 * floating dock is that the content keeps going underneath it. The web can
 * actually blur what is behind it. Native has no backdrop filter without a
 * native module, so it settles for a darker translucency, which reads as
 * smoked rather than frosted but still lets the page through.
 */
const GLASS = (Platform.OS === 'web'
  ? {
      backgroundColor: 'rgba(10, 14, 24, 0.55)',
      backdropFilter: 'blur(22px) saturate(150%)',
      WebkitBackdropFilter: 'blur(22px) saturate(150%)',
    }
  : { backgroundColor: 'rgba(10, 14, 24, 0.82)' }) as ViewStyle;

/** The height the dock occupies, so a screen can keep its content clear of it. */
export const DOCK_HEIGHT = 104;

const styles = StyleSheet.create({
  stage: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space.lg,
    alignItems: 'center',
  },
  dock: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingTop: space.xs,
    paddingBottom: 5,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: '#FFFFFF24',
    overflow: 'hidden',
  },
  /** A single bright hairline along the top, where light catches an edge. */
  glassEdge: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 0,
    height: 1,
    backgroundColor: '#FFFFFF40',
  },
  slot: { alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  // No chrome of its own: the icon is the tile. The shadow is what sets it on
  // the shelf rather than in it.
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  divider: { width: 1, height: BASE * 0.7, marginHorizontal: 3, backgroundColor: '#FFFFFF1F' },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'transparent' },
  standing: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textFaint,
    maxWidth: BASE + space.sm,
    textAlign: 'center',
  },
  standingOn: { color: color.redBright },
  dotOn: { backgroundColor: color.redBright },
  tipRow: { height: 26, justifyContent: 'flex-end', marginBottom: space.xs },
  tip: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: '#161C28',
    borderWidth: 1,
    borderColor: '#FFFFFF1A',
  },
  tipText: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    color: color.text,
  },
});
