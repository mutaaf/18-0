import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { EASE_OUT, Sheen, keyframes, useTimeline } from './Broadcast';
import {
  DECORATIVE,
  color,
  elevate,
  font,
  radius,
  space,
  tabular,
  themed,
  tracking,
  useThemeId,
} from '@/theme';

/**
 * The board outside the stadium.
 *
 * The landing page used to open with three lines of type on the bare ground,
 * which said what the game was and nothing about what it feels like. This is
 * the same three lines on a lit marquee: a truss with two floodlight cans over
 * it, a rim of bulbs chasing round the edge, and a scoreboard rail across the
 * bottom carrying the only numbers that matter before anybody has played --
 * how much history is in it, how much of that one spin can hand you, and how
 * rarely the thing in the title actually happens.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A COMPONENT RATHER THAN A BLOCK OF JSX ON THE SCREEN
 * ---------------------------------------------------------------------------
 *
 * The bulb rim has to be a function of the measured size -- bulbs spaced by
 * arclength around a rounded rectangle, at the *same* corner radius the board
 * is drawn with. `GlassSurface` learned that one the hard way: a fixed
 * `borderRadius` against a computed corner leaves a second, flatter rounded
 * rectangle behind the first with its corners sticking out past it. So the
 * board measures itself, one radius feeds the container, the ground and the
 * bulb walk, and none of that belongs inline in a screen.
 *
 * ---------------------------------------------------------------------------
 * MOTION
 * ---------------------------------------------------------------------------
 *
 * One clock lights the board -- floods, then bulbs, then a sheen across the
 * face -- on `useTimeline`, which skips itself entirely under Reduce Motion and
 * carries a failsafe that settles every layer whatever the driver did. The
 * chase round the rim is a second, deliberately separate loop, because it is
 * the one thing here that never ends; it is gated on the same accessibility
 * read the rest of the app uses, and when it does not run the bulbs sit lit.
 *
 * Nothing on the board is load-bearing. Every layer starts and ends at an
 * opacity, the type is plain `Text` underneath all of it, and if every
 * animation in this file failed the page would be a dark board with a headline
 * on it -- which is the state it is in before the lights come up anyway.
 */

/** The whole light-up, end to end. */
const LIT = 1500;

export interface BillboardStat {
  readonly value: string;
  readonly label: string;
  /** The one cell that wears gold. Spend it on the chase, never on a total. */
  readonly gold?: boolean;
}

export function Billboard({
  kicker,
  children,
  stats,
  /** Cells across the scoreboard rail. Two on a phone, four on a desktop. */
  columns = 2,
  /** Phone: the board bleeds past the content gutter. Desktop: it does not. */
  bleed = 0,
  padding = space.lg,
}: {
  kicker: string;
  /** The headline. Anything, but it is the reason the board is lit. */
  children: ReactNode;
  /** Empty draws no rail at all -- see the note where it is rendered. */
  stats: readonly BillboardStat[];
  columns?: number;
  bleed?: number;
  padding?: number;
}) {
  // Subscribed to the palette because nothing else here is: this draws from a
  // dozen tokens and has no prop that moves when the theme does.
  useThemeId();

  const [size, setSize] = useState({ width: 0, height: 0 });
  // False until the accessibility query answers, so the first frame is the
  // still one. A rim that starts chasing and then stops would be worse for the
  // person this is for than one that never started.
  const [motion, setMotion] = useState(false);
  const { t } = useTimeline(LIT);
  const chase = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => !cancelled && setMotion(!reduced))
      .catch(() => setMotion(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!motion) return;
    const loop = Animated.loop(
      Animated.timing(chase, {
        toValue: PHASES,
        duration: PHASES * 460,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [motion, chase]);

  const r = size.height > 0 ? Math.min(radius.xl, size.height * 0.1, size.width / 2) : radius.xl;
  const floods = keyframes(t, 120, 420, EASE_OUT);
  const ignite = keyframes(t, 300, 460, EASE_OUT);

  return (
    // No width of its own. A `width: '100%'` box with a negative margin slides
    // sideways instead of growing, so the board hung off the left of the phone
    // and stopped short of the right. Stretched by the column instead, the
    // margins do what they were asked to.
    <View style={[styles.rig, { marginHorizontal: -bleed }]}>
      <Truss lit={floods} />

      <View
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setSize((prev) =>
            prev.width === width && prev.height === height ? prev : { width, height },
          );
        }}
        style={[styles.board, elevate(10), { borderRadius: r, padding }]}
      >
        <Ground width={size.width} height={size.height} radius={r} />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: floods }]} {...DECORATIVE}>
          <Beams />
        </Animated.View>
        <Sheen t={t} at={620} duration={900} />
        <BulbRim
          width={size.width}
          height={size.height}
          radius={r}
          ignite={ignite}
          chase={motion ? chase : null}
        />

        <View style={styles.face}>
          <View style={styles.kickerRow}>
            <View style={styles.kickerDot} {...DECORATIVE} />
            <Text style={styles.kicker}>{kicker}</Text>
          </View>

          {children}

          {/* No rail when the caller hands over no stats: on a gameday the
              marquee underneath is carrying the numbers, and the board's job
              that day is to be a sign rather than a second scoreboard. */}
          {stats.length > 0 ? (
            <View style={styles.rail}>
              {/* Rows the caller asked for, rather than `flexWrap` and a basis.
                  A wrapping rail is a guess about a width nobody measured: at a
                  150-point basis it stacked all four cells in a column on a
                  phone, and at 112 it would have put three across and one
                  underneath on every screen between about 410 and 530 points
                  wide. Chunking is the same layout with the arithmetic taken
                  out of it. */}
              {rows(stats, columns).map((row, index) => (
                <View key={index} style={styles.railRow}>
                  {row.map((stat) => (
                    <View key={stat.label} style={styles.cell}>
                      <Text style={[styles.cellValue, stat.gold && styles.cellValueGold]}>
                        {stat.value}
                      </Text>
                      <Text style={styles.cellLabel} numberOfLines={2}>
                        {stat.label}
                      </Text>
                    </View>
                  ))}
                  {/* Keeps a short last row's cells the width of every other
                      row's, rather than one stat stretched across the board. */}
                  {Array.from({ length: columns - row.length }, (_, pad) => (
                    <View key={`pad-${pad}`} style={styles.cell} />
                  ))}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * The rig the lights hang off.
 *
 * Two cans hanging from a rail across the board's top edge, so the beams below
 * have somewhere to come from. Twenty-two points tall, and the whole difference
 * between a card with a gradient on it and a thing bolted to the outside of a
 * stadium.
 */
function Truss({ lit }: { lit: Animated.AnimatedInterpolation<number> }) {
  return (
    <View style={styles.truss} pointerEvents="none" {...DECORATIVE}>
      <View style={styles.trussRail} />
      {LAMPS.map((at) => (
        <View key={at} style={[styles.lamp, { left: `${at * 100}%` }]}>
          <View style={styles.lampArm} />
          <Animated.View style={[styles.lampFace, { opacity: lit }]} />
        </View>
      ))}
    </View>
  );
}

/** Where the two cans sit, as a fraction of the board's width. */
const LAMPS = [0.18, 0.82] as const;

/**
 * The board's own ground: lit at the top, gone at the bottom, with a grain.
 *
 * The grain is the same trick `StadiumBackdrop` uses on Turf and for the same
 * reason -- a flat fill at this size reads as wallpaper rather than a surface.
 * Here it runs in both themes, because the board is a printed thing in both.
 */
function Ground({ width, height, radius: r }: { width: number; height: number; radius: number }) {
  if (width === 0 || height === 0) return null;

  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      pointerEvents="none"
      {...DECORATIVE}
    >
      <Defs>
        {/* The bottom stop is `field`, not `void`. `void` is what the page
            itself is painted in, so a board that ends there ends nowhere: under
            Turf, whose ground is a saturated navy rather than a black, the
            lower half of the billboard dissolved into the screen behind it and
            took the bulbs along its bottom edge with it. */}
        <LinearGradient id="bb-ground" x1="0" y1="0" x2="0.2" y2="1">
          <Stop offset="0" stopColor={color.navy} stopOpacity="0.6" />
          <Stop offset="0.45" stopColor={color.surface} stopOpacity="1" />
          <Stop offset="1" stopColor={color.field} stopOpacity="1" />
        </LinearGradient>
        {/* White, not a token: a highlight is light falling on the board, and
            it reads the same on either ground. */}
        <LinearGradient id="bb-gloss" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.10" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} rx={r} fill="url(#bb-ground)" />
      <Rect x="0" y="0" width={width} height={height * 0.4} rx={r} fill="url(#bb-gloss)" />
      {Array.from({ length: Math.floor(height / 7) }, (_, i) => (
        <Rect key={i} x={0} y={i * 7} width={width} height={1} fill="#FFFFFF" fillOpacity={0.022} />
      ))}
    </Svg>
  );
}

/**
 * What the cans are throwing.
 *
 * Faint on purpose, for the reason `GamedayHero`'s floodlights already record:
 * at any strength where the beam is obvious its straight edges are obvious too,
 * and two hard diagonals across a panel read as geometry rather than as light.
 * `backdropWarm` and `backdropCool` are the stadium backdrop's own two sources
 * -- red and blue under Broadcast's night game, green and blue under Turf's one
 * o'clock kickoff -- so the board is lit by the same lamps as the page it is
 * standing on.
 */
function Beams() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="bb-beam-warm" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color.backdropWarm} stopOpacity="0.20" />
          <Stop offset="0.7" stopColor={color.backdropWarm} stopOpacity="0.05" />
          <Stop offset="1" stopColor={color.backdropWarm} stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id="bb-beam-cool" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color.backdropCool} stopOpacity="0.18" />
          <Stop offset="0.7" stopColor={color.backdropCool} stopOpacity="0.04" />
          <Stop offset="1" stopColor={color.backdropCool} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d="M13 -4 L23 -4 L44 86 L-10 86 Z" fill="url(#bb-beam-cool)" />
      <Path d="M77 -4 L87 -4 L110 86 L56 86 Z" fill="url(#bb-beam-warm)" />
    </Svg>
  );
}

/**
 * The bulbs, and the chase.
 *
 * A marquee chases in three phases, which is also much the cheapest way to draw
 * one: every third bulb goes in one group, each group is its own absolutely
 * filled SVG inside its own `Animated.View`, and the whole chase is three
 * native-driven opacities off one clock rather than forty animated SVG
 * attributes a frame. Nesting them under the ignite opacity multiplies the two,
 * so the rim comes up dark and starts running in the same gesture.
 */
const PHASES = 3;

/** How far in from the board's edge the ring of bulbs is bolted. */
const INSET = 8;

function BulbRim({
  width,
  height,
  radius: r,
  ignite,
  chase,
}: {
  width: number;
  height: number;
  radius: number;
  ignite: Animated.AnimatedInterpolation<number>;
  /** `null` under Reduce Motion: one static ring, every bulb lit. */
  chase: Animated.Value | null;
}) {
  // Walked on a rectangle pulled in from the edge, not on the edge itself. The
  // board clips its children, so a ring centred on the border loses the outer
  // half of every bulb and the bottom row reads as a row of dashes.
  const bulbs = useMemo(
    () => perimeter(width - INSET * 2, height - INSET * 2, Math.max(0, r - INSET), 26),
    [width, height, r],
  );
  if (bulbs.length === 0) return null;

  const ring = (phase: number | null) => (
    <Svg
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {bulbs
        .filter((_, i) => phase === null || i % PHASES === phase)
        .map((point, i) => (
          <Bulb key={i} x={point.x + INSET} y={point.y + INSET} />
        ))}
    </Svg>
  );

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: ignite }]}
      pointerEvents="none"
      {...DECORATIVE}
    >
      {/* Not the chase frozen at some position: parking the clock leaves one
          phase lit and the other two at a third, which is a rim that looks half
          broken rather than a rim that is not moving. Somebody who asked for
          less motion gets every bulb on. */}
      {chase === null
        ? ring(null)
        : Array.from({ length: PHASES }, (_, phase) => (
            <Animated.View
              key={phase}
              style={[StyleSheet.absoluteFill, { opacity: phaseOpacity(chase, phase) }]}
            >
              {ring(phase)}
            </Animated.View>
          ))}
    </Animated.View>
  );
}

/** A filament with a halo. Two circles, because a lit bulb is not a dot. */
function Bulb({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Circle cx={x} cy={y} r={5.5} fill={color.gold} fillOpacity={0.16} />
      <Circle cx={x} cy={y} r={2.1} fill={color.goldBright} />
    </>
  );
}

/**
 * One group's brightness as the chase passes it.
 *
 * It wraps: the clock runs 0 to PHASES and restarts, so group 0 has to be lit
 * at both ends of the range or the rim blinks once per revolution.
 */
function phaseOpacity(chase: Animated.Value, phase: number) {
  const stops = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  const DIM = 0.34;
  const MID = 0.66;
  return chase.interpolate({
    inputRange: stops,
    outputRange: stops.map((stop) => {
      // Distance to this group's slot, measured the short way round.
      const raw = Math.abs(stop - phase);
      const d = Math.min(raw, PHASES - raw);
      if (d === 0) return 1;
      if (d <= 0.5) return MID;
      return DIM;
    }),
  });
}

/** `stats`, cut into rows of `columns`. */
function rows(stats: readonly BillboardStat[], columns: number): BillboardStat[][] {
  const width = Math.max(1, columns);
  const out: BillboardStat[][] = [];
  for (let i = 0; i < stats.length; i += width) out.push(stats.slice(i, i + width));
  return out;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Points spaced evenly by arclength around a rounded rectangle.
 *
 * Eight segments -- four straights and four quarter arcs -- walked as one
 * continuous length, so the spacing does not bunch at the corners the way it
 * does when each edge is filled independently.
 */
function perimeter(width: number, height: number, r: number, spacing: number): Point[] {
  if (width <= 0 || height <= 0) return [];
  const rr = Math.max(0, Math.min(r, width / 2, height / 2));
  const runX = Math.max(0, width - 2 * rr);
  const runY = Math.max(0, height - 2 * rr);
  const arc = (Math.PI * rr) / 2;

  const on = (cx: number, cy: number, fromDeg: number, k: number): Point => {
    const a = ((fromDeg + 90 * k) * Math.PI) / 180;
    return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) };
  };
  const along = (d: number) => (arc === 0 ? 0 : d / arc);

  const segments: { len: number; at: (d: number) => Point }[] = [
    { len: runX, at: (d) => ({ x: rr + d, y: 0 }) },
    { len: arc, at: (d) => on(width - rr, rr, -90, along(d)) },
    { len: runY, at: (d) => ({ x: width, y: rr + d }) },
    { len: arc, at: (d) => on(width - rr, height - rr, 0, along(d)) },
    { len: runX, at: (d) => ({ x: width - rr - d, y: height }) },
    { len: arc, at: (d) => on(rr, height - rr, 90, along(d)) },
    { len: runY, at: (d) => ({ x: 0, y: height - rr - d }) },
    { len: arc, at: (d) => on(rr, rr, 180, along(d)) },
  ];

  const total = segments.reduce((sum, s) => sum + s.len, 0);
  if (total === 0) return [];
  // A multiple of the phase count, so the chase meets itself at the seam.
  const count = Math.max(PHASES * 4, Math.round(total / spacing / PHASES) * PHASES);
  const step = total / count;

  const points: Point[] = [];
  let index = 0;
  let walked = 0;
  for (const segment of segments) {
    while (index < count && index * step < walked + segment.len) {
      points.push(segment.at(index * step - walked));
      index++;
    }
    walked += segment.len;
  }
  return points;
}

const styles = themed(() => StyleSheet.create({
  rig: { alignSelf: 'stretch' },

  // The rail runs across the top and the cans hang off it pointing down at the
  // board, which is the way round a real rig is bolted together. Drawn the
  // other way up -- rail at the bottom, lamps stacked above it -- it read as
  // two gold caps balanced on a wire.
  truss: { height: 22 },
  trussRail: {
    position: 'absolute',
    top: 0,
    left: '7%',
    right: '7%',
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: color.lineBright,
  },
  lamp: { position: 'absolute', top: 2, alignItems: 'center', marginLeft: -12 },
  lampArm: { width: 3, height: 6, backgroundColor: color.lineBright },
  lampFace: {
    width: 24,
    height: 11,
    borderBottomLeftRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    backgroundColor: color.goldBright,
    shadowColor: color.gold,
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 3 },
  },

  board: {
    width: '100%',
    borderWidth: 1,
    borderColor: color.lineGold,
    backgroundColor: color.field,
    overflow: 'hidden',
    shadowColor: color.void,
    shadowOpacity: 0.6,
  },
  /** Positioned, so it paints over the absolutely placed light behind it. */
  face: { zIndex: 1, gap: space.md },

  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kickerDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: color.actionBright },
  kicker: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.actionBright,
    flexShrink: 1,
  },

  rail: {
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: color.line,
    paddingTop: space.md,
    marginTop: space.xs,
  },
  railRow: { flexDirection: 'row', gap: space.md },
  cell: { flex: 1, minWidth: 0, gap: 1 },
  cellValue: {
    fontFamily: font.display,
    fontSize: 24,
    lineHeight: 26,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  cellValueGold: {
    color: color.goldBright,
    textShadowColor: color.goldGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  cellLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
}));
