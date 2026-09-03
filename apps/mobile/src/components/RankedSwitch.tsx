import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { color, elevate, font, radius, space, tracking, type PressState } from '@/theme';

const TRACK = 56;
const KNOB = 24;

/**
 * The switch that decides whether a season counts.
 *
 * It used to be a dim checkbox above the mode cards, which made the single
 * most consequential choice on the screen look like a preference. Whether the
 * server deals your spins, whether the roster is scored somewhere other than
 * this phone, and whether any of it can ever reach the leaderboard all hang on
 * it, and none of that was visible.
 *
 * So it is a switch that looks like one, it says which of the two states you
 * are in rather than only what the other one would do, and when it is on the
 * whole panel lights gold — the colour this app reserves for the chase.
 */
export function RankedSwitch({
  on,
  busy,
  onToggle,
}: {
  on: boolean;
  /** A ranked session is being opened; the choice is momentarily settled. */
  busy?: boolean;
  onToggle: () => void;
}) {
  const slide = useRef(new Animated.Value(on ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: on ? 1 : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 140,
    }).start();
  }, [on, slide]);

  const shift = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, TRACK - KNOB - 6],
  });

  return (
    <Pressable
      onPress={onToggle}
      disabled={busy}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: Boolean(busy) }}
      accessibilityLabel="Play for the leaderboard"
      style={({ hovered }: PressState) => [
        styles.panel,
        on && styles.panelOn,
        on && elevate(4),
        hovered && !on && { borderColor: color.lineBright },
        busy && { opacity: 0.7 },
      ]}
    >
      {/* The rail is how every other lit thing in this app announces itself. */}
      <View style={[styles.rail, on && styles.railOn]} pointerEvents="none" />

      <View style={[styles.crest, on && styles.crestOn]}>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Path
            d="M7 4h10v5a5 5 0 0 1-10 0z M7 5H4v2a3 3 0 0 0 3 3 M17 5h3v2a3 3 0 0 1-3 3 M12 17v4 M8 21h8"
            stroke={on ? color.gold : color.textFaint}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>

      <View style={styles.body}>
        <Text style={[styles.state, on && styles.stateOn]}>
          {on ? 'RANKED' : 'CASUAL'}
        </Text>
        <Text style={[styles.title, on && styles.titleOn]}>
          {on ? 'Playing for the leaderboard' : 'Playing for nothing'}
        </Text>
        <Text style={styles.copy}>
          {busy
            ? 'Opening a ranked game…'
            : on
              ? 'The server deals every spin and scores the roster. GM Mode and Scout seasons rank once you sign in.'
              : 'This season stays on your device. Tap to put it on the board.'}
        </Text>
      </View>

      <View style={[styles.track, on && styles.trackOn]}>
        <Animated.View
          style={[styles.knob, on && styles.knobOn, { transform: [{ translateX: shift }] }]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    paddingRight: space.lg,
    paddingLeft: space.lg + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#0A0E1799',
    overflow: 'hidden',
  },
  panelOn: {
    borderColor: `${color.gold}59`,
    backgroundColor: '#15100299',
    shadowColor: color.gold,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
  },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: 'transparent' },
  railOn: { backgroundColor: color.gold },

  crest: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF08',
  },
  crestOn: { borderColor: `${color.gold}4D`, backgroundColor: `${color.gold}14` },

  body: { flex: 1, minWidth: 0, gap: 2 },
  state: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
    color: color.textFaint,
  },
  stateOn: { color: color.gold },
  title: { fontFamily: font.heading, fontSize: 17, color: color.textDim },
  titleOn: { color: color.text },
  copy: { fontFamily: font.bodyRegular, fontSize: 12, lineHeight: 17, color: color.textFaint },

  track: {
    width: TRACK,
    height: KNOB + 6,
    borderRadius: (KNOB + 6) / 2,
    padding: 3,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.lineBright,
    backgroundColor: '#05070C',
  },
  trackOn: { borderColor: color.gold, backgroundColor: `${color.gold}2E` },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: color.textFaint,
  },
  knobOn: {
    backgroundColor: color.gold,
    shadowColor: color.gold,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
});
