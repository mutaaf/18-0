import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Line, Rect, Stop } from 'react-native-svg';
import { useFold, type Spread } from '@/features/fold';
import { gpu } from '@/features/gpu';
import { bendOf } from '@/features/gpu/color';
import { DECORATIVE, color, themed, useThemeId } from '@/theme';

type Split = Exclude<Spread, { kind: 'single' }>;

/**
 * Two panels and the seam between them, placed exactly where `spread` says.
 *
 * Absolute rather than flexed: on an iPhone Duo the seam is the fold, and its
 * position is a fact about the hardware rather than a share of the space. A
 * flex row with a 40-point gap would centre that gap in whatever room the
 * safe area left -- 42 points away from the crease on a real device.
 *
 * `first` is the leading panel (or the top one in tabletop), `second` the
 * trailing (or the bottom). Each panel clips its own content: a list that
 * overflows its panel must not draw across the hinge.
 */
export function SpreadLayout({
  spread,
  first,
  second,
}: {
  spread: Split;
  first: ReactNode;
  second: ReactNode;
}) {
  const columns = spread.kind === 'columns';
  const a = columns ? spread.leading : spread.top;
  const b = columns ? spread.trailing : spread.bottom;
  const place = (band: { start: number; size: number }) =>
    columns
      ? { left: band.start, width: band.size, top: 0, bottom: 0 }
      : { top: band.start, height: band.size, left: 0, right: 0 };

  return (
    <View style={styles.root}>
      <Animated.View entering={FadeInUp.duration(380)} style={[styles.panel, place(a)]}>
        {first}
      </Animated.View>
      <Seam spread={spread} />
      <Animated.View entering={FadeInDown.duration(380).delay(90)} style={[styles.panel, place(b)]}>
        {second}
      </Animated.View>
    </View>
  );
}

/**
 * The gutter, drawn as the spine of a book.
 *
 * Flat, it is one chalk line: enough to say the two halves are two panels.
 * Folded, the pages fall away from it into shadow, deepening as the hinge
 * closes -- the screen agreeing with the hand holding it. The hinge angle is
 * used here and nowhere else; layout reads only the fold's position.
 *
 * Nothing in it is touchable, and nothing touchable is ever placed in it:
 * the fold's band includes the 20-point margins Apple asks interactive content
 * to stay out of.
 */
const Seam = memo(function Seam({ spread }: { spread: Split }) {
  useThemeId();
  const { hinge } = useFold();
  const columns = spread.kind === 'columns';
  // 180 is flat; a book is held around 90-120. Deepest at a right angle.
  const bend = bendOf(hinge, spread.folded);
  const box = columns
    ? { left: spread.seam.start, width: spread.seam.size, top: 0, bottom: 0 }
    : { top: spread.seam.start, height: spread.seam.size, left: 0, right: 0 };

  return (
    <Animated.View entering={FadeIn.duration(500)} style={[styles.seam, box]} pointerEvents="none" {...DECORATIVE}>
      <GpuSeam
        columns={columns}
        bend={bend}
        colors={{ green: color.actionBright, ice: color.ice, shade: color.void }}
        fallback={<FlatSeam columns={columns} bend={bend} dashed={spread.source === 'virtual'} />}
      />
    </Animated.View>
  );
});

const GpuSeam = gpu(() => import('@/features/gpu/effects/seam'));

/** The seam in SVG: what draws before the GPU one loads, or instead of it. */
function FlatSeam({ columns, bend, dashed }: { columns: boolean; bend: number; dashed: boolean }) {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="spine" x1="0" y1="0" x2={columns ? '1' : '0'} y2={columns ? '0' : '1'}>
          <Stop offset="0" stopColor={color.void} stopOpacity="0" />
          <Stop offset="0.5" stopColor={color.void} stopOpacity={String(0.55 * bend)} />
          <Stop offset="1" stopColor={color.void} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#spine)" />
      {columns ? (
        <Line x1="50%" y1="6%" x2="50%" y2="94%" stroke={color.chalk} strokeOpacity={0.1 + 0.08 * bend} strokeWidth="1" strokeDasharray={dashed ? '2 6' : undefined} />
      ) : (
        <Line x1="6%" y1="50%" x2="94%" y2="50%" stroke={color.chalk} strokeOpacity={0.1 + 0.08 * bend} strokeWidth="1" strokeDasharray={dashed ? '2 6' : undefined} />
      )}
    </Svg>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { flex: 1 },
    panel: { position: 'absolute', overflow: 'hidden' },
    seam: { position: 'absolute' },
  }),
);
