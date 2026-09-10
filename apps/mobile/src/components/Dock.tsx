import { Fragment, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { DockIcon, type DockIconName } from './DockIcons';
import { GlassPaint, TINT, radiusFor } from './GlassSurface';
import { useHasHover } from './useHasHover';
import { color, elevate, font, radius, space, themed, tracking } from '@/theme';

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
  // Measured rather than assumed: the shelf is sized by its children, and the
  // glass has to be drawn at exactly that size to get a rim that follows the
  // corner instead of a hairline that stops short of it.
  const [shelf, setShelf] = useState({ width: 0, height: 0 });
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
      <View
        style={[
          styles.dock,
          TINT,
          elevate(10),
          shelf.height > 0 && { borderRadius: shelfRadius(shelf.width, shelf.height) },
        ]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setShelf((prev) =>
            prev.width === width && prev.height === height ? prev : { width, height },
          );
        }}
      >
        <GlassPaint
          width={shelf.width}
          height={shelf.height}
          radius={shelfRadius(shelf.width, shelf.height)}
          id="dock"
        />
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
      // Critically damped. The previous spring overshot, and a dock that
      // wobbles after the pointer has stopped moving reads as loose rather
      // than lively -- especially with five of them settling at once.
      bounciness: 0,
      speed: 16,
    }).start();
  }, [target, swell]);

  const box = swell.interpolate({ inputRange: [0, 1], outputRange: [BASE, PEAK] });
  const lift = swell.interpolate({ inputRange: [0, 1], outputRange: [0, -(PEAK - BASE) * 0.22] });
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
 * How round the shelf is, at the height it currently is.
 *
 * A dock is a lozenge, not a card -- just short of a full pill, so the straight
 * run along the top still reads as a shelf. It has to be a function rather than
 * a constant because the shelf grows as tiles magnify, and the container and
 * the drawing have to use the same one: a fixed corner against a computed one
 * left a second, flatter rounded rectangle behind the glass with its corners
 * sticking out past it.
 */
const shelfRadius = (w: number, h: number) => radiusFor(w, h, 0.46, Number.POSITIVE_INFINITY);

/** The height the dock occupies, so a screen can keep its content clear of it. */
export const DOCK_HEIGHT = 104;

const styles = themed(() => StyleSheet.create({
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
    paddingHorizontal: space.md,
    paddingTop: 9,
    paddingBottom: 7,
    // Replaced at runtime by `shelfRadius` once the shelf has been measured;
    // this is only what the very first frame is drawn with.
    borderRadius: radius.xl,
    // Not hidden: a swelling tile lifts above the shelf, the way a dock icon
    // does, and clipping it to the glass cut the tops off every magnified one.
    // Nothing here needs clipping -- the ground is a background colour on a
    // rounded box, and the lit edge is inset from both ends.
  },
  slot: { alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  // No chrome of its own: the icon is the tile. The shadow is what sets it on
  // the shelf rather than in it.
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.38,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
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
  standingOn: { color: color.actionBright },
  dotOn: { backgroundColor: color.actionBright },
  tipRow: { height: 26, justifyContent: 'flex-end', marginBottom: space.xs },
  tip: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: color.surfaceRaised,
    borderWidth: 1,
    borderColor: '#FFFFFF1A',
  },
  tipText: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    color: color.text,
  },
}));
