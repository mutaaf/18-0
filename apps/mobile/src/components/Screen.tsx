import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { DECORATIVE, color, themed, useLayout, useThemeId } from '@/theme';

/**
 * The stadium bowl: two blown-out light sources bleeding in from the upper
 * corners, the way broadcast cameras see a night game.
 *
 * `useThemeId` is not decoration here. This component is `memo`d, so a theme
 * change never reaches it through its parent -- there are no props to change.
 * The subscription is what re-renders it, and without it the app switches to a
 * navy identity while the backdrop behind everything stays black.
 */
export const StadiumBackdrop = memo(function StadiumBackdrop() {
  const theme = useThemeId();

  return (
    <Svg
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      {...DECORATIVE}
    >
      <Defs>
        <RadialGradient id="lightL" cx="10%" cy="-4%" r="66%">
          <Stop offset="0" stopColor={color.backdropCool} stopOpacity="0.34" />
          <Stop offset="0.5" stopColor={color.navy} stopOpacity="0.16" />
          <Stop offset="1" stopColor={color.void} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="lightR" cx="94%" cy="2%" r="60%">
          <Stop offset="0" stopColor={color.backdropWarm} stopOpacity="0.22" />
          <Stop offset="1" stopColor={color.void} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="floor" cx="50%" cy="110%" r="74%">
          <Stop offset="0" stopColor={color.navy} stopOpacity="0.42" />
          <Stop offset="1" stopColor={color.void} stopOpacity="0" />
        </RadialGradient>
        {/*
          Turf's ground is a flat saturated navy, and flat navy at full screen
          reads as a wallpaper rather than a surface. The pinstripe is what
          gives it a weave -- barely visible, and entirely the difference
          between "a blue rectangle" and "a printed field".
        */}
        <Pattern id="weave" width="14" height="14" patternUnits="userSpaceOnUse">
          <Line x1="0" y1="14" x2="14" y2="0" stroke="#FFFFFF" strokeOpacity="0.035" strokeWidth="3" />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={color.void} />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#floor)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#lightL)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#lightR)" />
      {theme === 'turf' ? (
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#weave)" />
      ) : null}
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

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  safe: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%' },
}));
