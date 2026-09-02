import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { DECORATIVE, color, useLayout } from '@/theme';

/**
 * The stadium bowl: near-black, with two blown-out light sources bleeding in
 * from the upper corners the way broadcast cameras see a night game.
 */
export const StadiumBackdrop = memo(function StadiumBackdrop() {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      {...DECORATIVE}
    >
      <Defs>
        <RadialGradient id="lightL" cx="10%" cy="-4%" r="66%">
          <Stop offset="0" stopColor="#2D6BB5" stopOpacity="0.34" />
          <Stop offset="0.5" stopColor="#013369" stopOpacity="0.16" />
          <Stop offset="1" stopColor="#06080F" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="lightR" cx="94%" cy="2%" r="60%">
          <Stop offset="0" stopColor="#8E1620" stopOpacity="0.22" />
          <Stop offset="1" stopColor="#06080F" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="floor" cx="50%" cy="110%" r="74%">
          <Stop offset="0" stopColor="#013369" stopOpacity="0.42" />
          <Stop offset="1" stopColor="#06080F" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={color.void} />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#floor)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#lightL)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#lightR)" />
      <Circle cx="10%" cy="-2%" r="3" fill="#DCE8F5" opacity="0.5" />
      <Circle cx="90%" cy="1%" r="2.5" fill="#DCE8F5" opacity="0.35" />
    </Svg>
  );
});

/**
 * The game is phone-first, so on a wide screen it holds a bounded column
 * rather than stretching a 96-pixel roster card across a desktop. How wide
 * that column is depends on the breakpoint — see `useLayout`.
 */
export function Screen({
  children,
  edges = ['top'],
  maxWidth,
}: {
  children: ReactNode;
  edges?: Edge[];
  maxWidth?: number;
}) {
  const layout = useLayout();
  return (
    <View style={styles.root}>
      <StadiumBackdrop />
      <SafeAreaView style={styles.safe} edges={edges}>
        <View style={[styles.column, { maxWidth: maxWidth ?? Math.min(layout.maxWidth, 620) }]}>
          {children}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  safe: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%' },
});
