import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { elevate, themed } from '@/theme';

/**
 * Glass, as a surface anything can sit on.
 *
 * It started as the dock's shelf and stayed there for exactly as long as it
 * took to want a second one. The construction is the part worth sharing, and
 * it is three things a flat panel with a border does not have:
 *
 *   - a **ground that falls off downwards**, because light comes from above and
 *     a slab of even translucency reads as paint rather than glass;
 *   - a **gloss** over the top half, which is the specular highlight;
 *   - a **rim** that is brightest where light lands and nearly gone underneath,
 *     rather than a `borderWidth` that is equally bright all the way round --
 *     that is what makes a box look drawn instead of lit.
 *
 * ---------------------------------------------------------------------------
 * WHY IT MEASURES ITSELF
 * ---------------------------------------------------------------------------
 *
 * The radius has to be a function of the height, and the container and the
 * drawing have to use *the same* function. The dock got this wrong first: a
 * fixed `borderRadius` against a computed corner left a second, flatter rounded
 * rectangle behind the glass with its corners sticking out past it, and it only
 * showed up once the shelf started growing under the pointer.
 *
 * So the surface measures itself, derives one radius, and hands it to both.
 *
 * The drawing stretches to the box rather than being sized in pixels:
 * react-native-svg writes `width`/`height` as integer attributes, so a
 * 357.43-wide surface was getting a 354-wide glass and the tint underneath
 * showed along the edge.
 */
export function GlassSurface({
  children,
  style,
  /**
   * Corner radius as a fraction of the height, capped at a semicircle.
   *
   * `0.46` is the dock: a lozenge, just short of a pill. A panel wants
   * something much flatter -- it is a sheet of glass, not a pebble.
   */
  round = 0.16,
  /** Maximum corner in points, for a surface tall enough that the ratio runs away. */
  maxRound = 28,
  raised = 6,
  pointerEvents,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  round?: number;
  maxRound?: number;
  raised?: number;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const r = radiusFor(size.width, size.height, round, maxRound);

  return (
    <View
      pointerEvents={pointerEvents}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      }}
      style={[
        styles.surface,
        TINT,
        elevate(raised),
        size.height > 0 && { borderRadius: r },
        style,
      ]}
    >
      <GlassPaint width={size.width} height={size.height} radius={r} />
      {children}
    </View>
  );
}

export function radiusFor(
  width: number,
  height: number,
  round: number,
  maxRound: number,
): number {
  if (height === 0) return maxRound;
  return Math.min(height * round, maxRound, width / 2);
}

/** The three layers, drawn at whatever size the surface turned out to be. */
export function GlassPaint({
  width,
  height,
  radius,
  /** Unique per surface: two gradients cannot share an id on one screen. */
  id = 'glass',
}: {
  width: number;
  height: number;
  radius: number;
  id?: string;
}) {
  if (width === 0 || height === 0) return null;
  const inset = 0.75;

  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id={`${id}-ground`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.14" />
          <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.05" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.015" />
        </LinearGradient>
        <LinearGradient id={`${id}-gloss`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.16" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.34" />
          <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0.06" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.13" />
        </LinearGradient>
      </Defs>

      <Rect x="0" y="0" width={width} height={height} rx={radius} fill={`url(#${id}-ground)`} />
      {/* Fades to zero before the bottom corners, so its own rounding never shows. */}
      <Rect x="0" y="0" width={width} height={height * 0.55} rx={radius} fill={`url(#${id}-gloss)`} />
      <Rect
        x={inset}
        y={inset}
        width={width - inset * 2}
        height={height - inset * 2}
        rx={Math.max(0, radius - inset)}
        fill="none"
        stroke={`url(#${id}-rim)`}
        strokeWidth={1.25}
      />
    </Svg>
  );
}

/**
 * The tint under the glass.
 *
 * The web can blur what is behind it, which is the whole difference between
 * frosted and smoked. Native has no backdrop filter without a native module, so
 * it settles for a darker translucency -- still letting the page through, just
 * not bending it.
 */
export const TINT = (Platform.OS === 'web'
  ? {
      backgroundColor: 'rgba(10, 14, 24, 0.55)',
      backdropFilter: 'blur(22px) saturate(150%)',
      WebkitBackdropFilter: 'blur(22px) saturate(150%)',
    }
  : { backgroundColor: 'rgba(10, 14, 24, 0.82)' }) as ViewStyle;

// Nothing here comes from the palette, deliberately: the tint is a neutral
// darkening of whatever is behind it, which is what lets one surface work on
// both grounds without knowing which one it is on.
const styles = themed(() => StyleSheet.create({
  surface: { overflow: 'visible' },
}));
