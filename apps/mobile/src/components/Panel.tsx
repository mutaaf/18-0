import { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { color, elevate, radius } from '@/theme';

/**
 * A surface with a light source.
 *
 * Every panel on the landing screen was the same flat `#FFFFFF05` rectangle
 * with the same hairline border, which made a column of them read as one grey
 * wall: nothing was nearer than anything else, and nothing said which of them
 * held the number worth looking at.
 *
 * This gives them a top-lit ground, a rim that catches at the top edge, and an
 * optional accent — a rail down the left and a wash of the accent's own colour
 * through the ground. The accent is the whole point: it is spent on panels
 * that have earned it, so a lit panel means something happened.
 */
export function Panel({
  children,
  tint,
  raised = true,
  style,
  contentStyle,
}: {
  children: ReactNode;
  /** Accent colour. Omit for the plain graphite surface. */
  tint?: string;
  raised?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Padding and gap belong here, not on the panel: the ground fills the frame. */
  contentStyle?: StyleProp<ViewStyle>;
}) {
  // Unique per tint, because two gradients cannot share an id on one screen.
  const id = `panel-${(tint ?? 'plain').replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <View
      style={[
        styles.panel,
        { borderColor: tint ? `${tint}40` : color.line },
        raised && elevate(3),
        style,
      ]}
    >
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id={`${id}-ground`} x1="0" y1="0" x2="0.25" y2="1">
            <Stop offset="0" stopColor="#1A2233" stopOpacity="0.9" />
            <Stop offset="1" stopColor="#080B12" stopOpacity="0.95" />
          </LinearGradient>
          <LinearGradient id={`${id}-wash`} x1="0" y1="0" x2="0.6" y2="1">
            <Stop offset="0" stopColor={tint ?? '#FFFFFF'} stopOpacity="0.16" />
            <Stop offset="1" stopColor={tint ?? '#FFFFFF'} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id={`${id}-gloss`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.09" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}-ground)`} />
        {tint ? <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}-wash)`} /> : null}
        {/* The gloss is short: light falls on the top edge, not down the face. */}
        <Rect x="0" y="0" width="100%" height="38" fill={`url(#${id}-gloss)`} />
      </Svg>

      {tint ? <View style={[styles.rail, { backgroundColor: tint }]} pointerEvents="none" /> : null}

      {/* Positioned, so it paints over the absolutely placed ground behind it. */}
      <View style={[styles.body, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: '#080B12',
  },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  body: { zIndex: 1 },
});
