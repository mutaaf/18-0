import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Rail as RailGeometry } from '@/features/fold';
import { DockIcon } from './DockIcons';
import type { DockItemSpec } from './Dock';
import { GlassPaint, TINT } from './GlassSurface';
import { color, elevate, font, space, themed, tracking, type PressState } from '@/theme';

/**
 * The navigation as a vertical rail on the trailing edge.
 *
 * Where the system puts its own tab bar on an iPhone Duo open as a book: in
 * the 84 pt column it shares with the status bar. A custom bar has to get
 * there by itself -- Apple's words are that there is no API that moves one --
 * so `navRail()` decides when, and this draws it.
 *
 * The status bar holds the top of that column, so the shelf is centred in
 * what is left and the account disc takes the foot of it, the way a sidebar
 * ends on the person using it.
 *
 * Icons with a word under each, never icons alone: the HIG drops an item from
 * a vertical bar if it has a title and no symbol, and a kid reading "RANKS"
 * finds the leaderboard faster than one decoding a podium.
 */
export function Rail({
  rail,
  items,
  activeIndex,
  onSelect,
}: {
  rail: RailGeometry;
  items: DockItemSpec[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [shelf, setShelf] = useState({ width: 0, height: 0 });

  return (
    <View
      style={[
        styles.column,
        {
          width: rail.width,
          // Clear of the status bar at the top of the column and of the
          // account disc at its foot.
          top: insets.top + STATUS_CLEARANCE,
          bottom: Math.max(insets.bottom, space.md) + ACCOUNT_CLEARANCE,
        },
      ]}
      pointerEvents="box-none"
    >
      <View
        style={[styles.shelf, TINT, elevate(10)]}
        accessibilityRole="tablist"
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setShelf((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
        }}
      >
        <GlassPaint width={shelf.width} height={shelf.height} radius={SHELF_RADIUS} id="rail" />
        {items.map((item, index) => (
          <RailTile key={item.key} item={item} active={index === activeIndex} onPress={() => onSelect(index)} />
        ))}
      </View>
    </View>
  );
}

function RailTile({ item, active, onPress }: { item: DockItemSpec; active: boolean; onPress: () => void }) {
  const lit = useAnimatedStyle(() => ({
    opacity: withSpring(active ? 1 : 0, { damping: 18, reduceMotion: ReduceMotion.System }),
    transform: [{ scaleY: withSpring(active ? 1 : 0.3, { damping: 14, reduceMotion: ReduceMotion.System }) }],
  }));
  const icon = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(active ? 1.12 : 1, { damping: 12, stiffness: 220, reduceMotion: ReduceMotion.System }) }],
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.label}
      hitSlop={4}
      style={({ pressed, hovered }: PressState) => [
        styles.tile,
        hovered && styles.tileHover,
        pressed && styles.tilePressed,
      ]}
    >
      {/* The lit edge faces the content, the way a selected page's tab does. */}
      <Animated.View style={[styles.lit, lit]} pointerEvents="none" />
      <Animated.View style={icon}>
        <DockIcon name={item.icon} size={ICON} />
      </Animated.View>
      <Text style={[styles.label, active && styles.labelOn]} numberOfLines={1}>
        {item.short}
      </Text>
    </Pressable>
  );
}

const ICON = 38;
const SHELF_RADIUS = 30;
/** The status bar's share of the column on a Duo: the time and its rings. */
const STATUS_CLEARANCE = 120;
/** The account disc and the gap above it. */
const ACCOUNT_CLEARANCE = 46 + space.lg;

const styles = themed(() =>
  StyleSheet.create({
    column: {
      position: 'absolute',
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 15,
    },
    shelf: {
      width: 66,
      alignItems: 'center',
      gap: space.xs,
      paddingVertical: space.sm,
      borderRadius: SHELF_RADIUS,
    },
    tile: {
      width: 60,
      alignItems: 'center',
      gap: 3,
      paddingVertical: 5,
      borderRadius: 18,
    },
    tileHover: { backgroundColor: '#FFFFFF0D' },
    tilePressed: { transform: [{ scale: 0.92 }] },
    lit: {
      position: 'absolute',
      left: -3,
      top: 10,
      bottom: 10,
      width: 3,
      borderRadius: 2,
      backgroundColor: color.actionBright,
    },
    label: {
      fontFamily: font.label,
      fontSize: 9,
      letterSpacing: tracking.wide,
      textTransform: 'uppercase',
      color: color.textFaint,
    },
    labelOn: { color: color.actionBright },
  }),
);

/** Where the account disc sits when the rail is up: centred at the column's foot. */
export function railAccountPosition(rail: RailGeometry, insetBottom: number, size: number) {
  return { right: (rail.width - size) / 2, bottom: Math.max(insetBottom, space.md) };
}
