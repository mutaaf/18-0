import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { distribution, ring, trend, winColumns } from '@/features/charts/geometry';
import { DECORATIVE, color, font, space, tabular, themed, tracking, useThemeId } from '@/theme';

/**
 * The app's charts.
 *
 * Geometry comes from `features/charts/geometry.ts` (d3, pure); drawing is
 * `react-native-svg`, so a chart is the same picture on iOS, Android and the
 * web. Colours are theme tokens throughout: green for the player's own
 * numbers, ice blue for the field around them, gold for the one thing worth
 * celebrating -- the same three meanings everywhere else in the game.
 *
 * Every chart measures its own width and draws nothing until it has one: a
 * chart drawn at a guessed width and then redrawn is a chart that jumps.
 * Every chart is also a single accessible element with a sentence for a
 * label, because a path has nothing for a screen reader to say.
 */

function Measured({
  height,
  label,
  children,
}: {
  height: number;
  label: string;
  children: (width: number) => ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };
  return (
    <View style={{ height }} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={label}>
      {width > 0 ? (
        <Animated.View entering={FadeIn.duration(420)} style={StyleSheet.absoluteFill} {...DECORATIVE}>
          {children(width)}
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * Where the board's seasons fall, and where yours is among them.
 */
export function RatingRidge({
  ratings,
  you,
  height = 132,
}: {
  ratings: readonly number[];
  you?: number | null;
  height?: number;
}) {
  useThemeId();
  if (ratings.length < 2) return null;
  const label =
    `How the ${ratings.length} seasons on this board are spread, from ${Math.min(...ratings).toFixed(1)} ` +
    `to ${Math.max(...ratings).toFixed(1)}` +
    (you != null ? `. Yours is ${you.toFixed(1)}.` : '.');
  return (
    <Measured height={height} label={label}>
      {(width) => {
        const d = distribution(ratings, { width, height });
        if (!d) return null;
        const yx = you != null ? d.x(you) : null;
        return (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="ridgeFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color.ice} stopOpacity="0.38" />
                <Stop offset="1" stopColor={color.ice} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Line x1="0" y1={d.baseline} x2={width} y2={d.baseline} stroke={color.line} strokeWidth="1" />
            <Path d={d.area} fill="url(#ridgeFill)" />
            <Path d={d.line} fill="none" stroke={color.ice} strokeWidth="2" strokeLinejoin="round" />
            {d.ticks.map((t) => (
              <SvgText key={t.value} x={t.x} y={height - 3} fill={color.textFaint} fontSize="10" fontFamily={font.label} textAnchor="middle">
                {String(t.value)}
              </SvgText>
            ))}
            {yx !== null ? (
              <G>
                <Line x1={yx} y1={8} x2={yx} y2={d.baseline} stroke={color.action} strokeWidth="2" strokeDasharray="3 3" />
                <Circle cx={yx} cy={8} r="5" fill={color.action} stroke={color.void} strokeWidth="2" />
                <SvgText x={yx} y={8} dx={yx > width - 40 ? -10 : 10} dy="4" fill={color.actionBright} fontSize="11" fontFamily={font.label} textAnchor={yx > width - 40 ? 'end' : 'start'}>
                  YOU
                </SvgText>
              </G>
            ) : null}
          </Svg>
        );
      }}
    </Measured>
  );
}

/**
 * Every season, in order, with a short rolling average through it.
 */
export function RatingTrend({ ratings, height = 160 }: { ratings: readonly number[]; height?: number }) {
  useThemeId();
  if (ratings.length < 2) return null;
  const best = Math.max(...ratings);
  const label = `Your last ${ratings.length} ratings, oldest first. Best ${best.toFixed(1)}, latest ${ratings[ratings.length - 1]!.toFixed(1)}.`;
  return (
    <Measured height={height} label={label}>
      {(width) => {
        const t = trend(ratings, { width, height, pad: { top: 14, right: 12, bottom: 10, left: 30 } });
        if (!t) return null;
        return (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color.action} stopOpacity="0.32" />
                <Stop offset="1" stopColor={color.action} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            {t.gridlines.map((g) => (
              <G key={g.value}>
                <Line x1={30} y1={g.y} x2={width - 4} y2={g.y} stroke={color.line} strokeWidth="1" strokeOpacity="0.6" />
                <SvgText x={24} y={g.y + 3} fill={color.textFaint} fontSize="10" fontFamily={font.label} textAnchor="end">
                  {String(g.value)}
                </SvgText>
              </G>
            ))}
            <Path d={t.area} fill="url(#trendFill)" />
            <Path d={t.average} fill="none" stroke={color.ice} strokeWidth="1.5" strokeDasharray="4 4" strokeOpacity="0.85" />
            <Path d={t.line} fill="none" stroke={color.action} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
            <Circle cx={t.best.x} cy={t.best.y} r="5.5" fill={color.gold} stroke={color.void} strokeWidth="2" />
            <Circle cx={t.last.x} cy={t.last.y} r="4" fill={color.actionBright} stroke={color.void} strokeWidth="2" />
          </Svg>
        );
      }}
    </Measured>
  );
}

/**
 * Every record from 0-17 to 17-0. The last two columns are gold, because
 * those are the two the whole game is about, and empty columns still draw
 * their slot so the gap at the end can be seen.
 */
export function WinsChart({ wins, height = 120 }: { wins: readonly number[]; height?: number }) {
  useThemeId();
  if (wins.length === 0) return null;
  const label = `How many wins your ${wins.length} seasons reached. Most common: ${mode(wins)}.`;
  return (
    <Measured height={height} label={label}>
      {(width) => {
        const cols = winColumns(wins, { width, height, pad: { top: 6, right: 2, bottom: 18, left: 2 } });
        return (
          <Svg width={width} height={height}>
            {cols.map((c) => {
              const chase = c.wins >= 16;
              return (
                <G key={c.wins}>
                  <Rect x={c.x} y={6} width={c.width} height={height - 24} rx={Math.min(3, c.width / 2)} fill={color.chalk} opacity="0.35" />
                  {c.count > 0 ? (
                    <Rect x={c.x} y={c.y} width={c.width} height={c.height} rx={Math.min(3, c.width / 2)} fill={chase ? color.gold : color.action} />
                  ) : null}
                  {c.wins % 4 === 1 || c.wins === 17 ? (
                    <SvgText x={c.x + c.width / 2} y={height - 4} fill={chase ? color.gold : color.textFaint} fontSize="10" fontFamily={font.label} textAnchor="middle">
                      {String(c.wins)}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
          </Svg>
        );
      }}
    </Measured>
  );
}

function mode(values: readonly number[]): string {
  const counts = new Map<number, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const [wins] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return `${wins}-${17 - wins}`;
}

/** How the seasons split across modes, as a ring with its legend beside it. */
export function ModeRing<K extends string>({
  parts,
  labels,
  tints,
  size = 96,
}: {
  parts: readonly { key: K; count: number }[];
  labels: Record<K, string>;
  tints: Record<K, string>;
  size?: number;
}) {
  useThemeId();
  const slices = ring(parts, size);
  if (slices.length === 0) return null;
  const total = parts.reduce((t, p) => t + p.count, 0);
  return (
    <View style={styles.ringRow} accessible accessibilityLabel={slices.map((s) => `${labels[s.key]} ${Math.round(s.share * 100)} percent`).join(', ')}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} {...DECORATIVE}>
          <G x={size / 2} y={size / 2}>
            {slices.map((s) => (
              <Path key={s.key} d={s.path} fill={tints[s.key]} />
            ))}
          </G>
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.ringCenter]} pointerEvents="none">
          <Text style={styles.ringTotal}>{total}</Text>
          <Text style={styles.ringCaption}>seasons</Text>
        </View>
      </View>
      <View style={styles.legend}>
        {slices.map((s) => (
          <View key={s.key} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: tints[s.key] }]} />
            <Text style={styles.legendLabel} numberOfLines={1}>
              {labels[s.key]}
            </Text>
            <Text style={styles.legendValue}>{Math.round(s.share * 100)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    ringRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
    ringCenter: { alignItems: 'center', justifyContent: 'center' },
    ringTotal: { fontFamily: font.display, fontSize: 24, color: color.text, includeFontPadding: false, ...tabular },
    ringCaption: { fontFamily: font.label, fontSize: 9, letterSpacing: tracking.wide, color: color.textFaint, textTransform: 'uppercase' },
    legend: { flex: 1, minWidth: 0, gap: space.xs },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    swatch: { width: 10, height: 10, borderRadius: 5 },
    legendLabel: { flex: 1, fontFamily: font.body, fontSize: 13, color: color.textDim },
    legendValue: { fontFamily: font.display, fontSize: 15, color: color.text, ...tabular },
  }),
);
