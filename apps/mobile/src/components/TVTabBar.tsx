import { forwardRef, useState, type ElementRef } from 'react';
import { StyleSheet, TVFocusGuideView, Text, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from '@/components/Pressable';
import type { DockItemSpec } from './Dock';
import { color, font, space, themed, tracking } from '@/theme';

/**
 * The Apple TV's navigation: a row of words across the top, the way tvOS's
 * own tab bar is -- not a dock.
 *
 * The dock was a phone's idea scaled up. Icons the size of a thumbnail at the
 * bottom of a television, a magnification that followed the remote (layout,
 * on the JS thread, five tiles per frame), and a page you had to press down
 * through to reach it. On a TV the tabs are text, they sit above the page, up
 * from anywhere lands on the one you are on, and the focused one is a white
 * pill with dark type -- the one look every tvOS app shares, so nobody has to
 * learn it.
 *
 * Selecting a tab is a click, not a focus: tvOS switches on focus, but here
 * every tab is a whole screen, and mounting one per press of the remote as it
 * crosses the bar is exactly the work this file exists to avoid.
 *
 * Transform and opacity only (docs/apple-tv.md, "Real hardware"): the pill
 * and the "you are here" wash are views that are always mounted and only
 * fade and scale.
 */

/** The height the bar takes above the page, in stage points. */
export const TV_TAB_BAR_HEIGHT = 64;

export function TVTabBar({
  items,
  activeIndex,
  onSelect,
}: {
  items: DockItemSpec[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    // The guide is the full width of the screen, not the row: up from a row
    // at the far left of the page has to find the bar too. `autoFocus` hands
    // focus to the tab it was last on -- the one you picked -- and lets it
    // move freely once inside.
    //
    // Not `destinations`, which builds 27 and 28's bar (and the dock and the
    // rail before it) used: aimed at a Pressable, which on a TV is an animated
    // component and not the native view a guide needs, the guide had nowhere
    // to send focus and took it itself -- an invisible full-width box that
    // Select did nothing on. The remote harness found it (test11_TabBar).
    <TVFocusGuideView autoFocus style={[styles.stage, { top: insets.top }]}>
      <View style={styles.row}>
        {items.map((item, index) => (
          <Tab
            key={item.key}
            label={item.label}
            active={index === activeIndex}
            onPress={() => onSelect(index)}
          />
        ))}
      </View>
    </TVFocusGuideView>
  );
}

const SPRING = { damping: 18, stiffness: 280, mass: 0.6, reduceMotion: ReduceMotion.System };

const Tab = forwardRef<
  ElementRef<typeof Pressable>,
  { label: string; active: boolean; onPress: () => void }
>(
  function Tab({ label, active, onPress }, ref) {
    const [focused, setFocused] = useState(false);
    const f = useSharedValue(0);

    const pill = useAnimatedStyle(() => ({
      opacity: f.value,
      transform: [{ scale: 0.92 + 0.08 * f.value }],
    }));
    const lift = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.06 * f.value }] }));

    return (
      <Pressable
        ref={ref}
        // The pill is the focus look; Pressable's own lift and rim would be a
        // second one on top of it.
        tvFocus="none"
        onPress={onPress}
        onFocus={() => {
          setFocused(true);
          f.value = withSpring(1, SPRING);
        }}
        onBlur={() => {
          setFocused(false);
          f.value = withTiming(0, { duration: 140, reduceMotion: ReduceMotion.System });
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        // XCUITest reports a focused tab with no label; the harness reads this.
        testID={label}
        style={styles.tab}
      >
        <Animated.View style={[styles.face, lift]}>
          {active ? <View style={styles.here} pointerEvents="none" /> : null}
          <Animated.View style={[styles.pill, pill]} pointerEvents="none" />
          <Text style={[styles.label, active && styles.labelHere, focused && styles.labelFocused]} numberOfLines={1}>
            {label}
          </Text>
        </Animated.View>
      </Pressable>
    );
  },
);

const styles = themed(() =>
  StyleSheet.create({
    stage: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 15 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      height: TV_TAB_BAR_HEIGHT - space.md,
      paddingHorizontal: space.xs,
    },
    tab: { borderRadius: 999 },
    face: {
      paddingHorizontal: space.lg,
      height: 40,
      borderRadius: 999,
      justifyContent: 'center',
      alignItems: 'center',
    },
    // Where you are, when the remote is somewhere else: a quiet frosted pill.
    here: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, backgroundColor: color.lineBright },
    // Where the remote is: tvOS's white pill.
    pill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, backgroundColor: color.text },
    label: {
      fontFamily: font.label,
      fontSize: 17,
      letterSpacing: tracking.normal,
      color: color.textDim,
    },
    labelHere: { color: color.text },
    labelFocused: { color: color.void },
  }),
);
