import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { eraLabel, franchise } from '@18-0/data';
import { GlassSurface } from './GlassSurface';
import { useWidth } from './useWidth';
import { MODE_LABEL, type GameMode } from '@/state/game';
import { useHistoryStore } from '@/state/history';
import {
  careerReport,
  cumulative,
  percentileOf,
  quantile,
  type CareerReport,
} from '@/state/career';
import {
  DECORATIVE,
  color,
  font,
  radius,
  space,
  tabular,
  themed,
  tracking,
  type PressState,
} from '@/theme';

/**
 * Your career, from the twenty-five numbers it already computed.
 *
 * The account screen had a level, a name and a delete link, and the only place
 * a player could see what they were actually like was a tab of four tiles. This
 * is the analysis: where your ratings land, whether you are getting better,
 * which modes you reach for and who you build with.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE WALKS THE HISTORY
 * ---------------------------------------------------------------------------
 *
 * `careerReport` does that once, cached on the store's array, and every figure
 * on this panel comes out of what it returned. In particular the two chart
 * views are the *same twenty-five buckets* read two ways -- counts, and their
 * running total -- so switching between them is twenty-five additions rather
 * than a second look at five hundred seasons. The percentile lines are read off
 * the same table. That is the whole reason the control is cheap enough to be a
 * control at all.
 */

const CHART_HEIGHT = 96;
const FORM_HEIGHT = 54;
/** Radius of the marker on the newest season. */
const DOT = 3.5;

type ChartView = 'spread' | 'percentiles';

export function CareerPanel() {
  const games = useHistoryStore((s) => s.games);
  // No `useMemo`: the report is memoised on the array itself, so the panels
  // that want it share one build rather than each holding their own copy of
  // the same answer behind their own dependency list.
  const report = careerReport(games);
  const [view, setView] = useState<ChartView>('spread');
  const [width, onLayout] = useWidth();

  if (report.total === 0) return null;

  return (
    <GlassSurface round={0.04} maxRound={radius.lg} style={styles.panel}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>Career</Text>
        <Text style={styles.headCount}>
          {report.total} season{report.total === 1 ? '' : 's'}
          {report.assisted > 0 ? ` · ${report.assisted} rigged` : ''}
        </Text>
      </View>

      <View style={styles.tiles}>
        <Tile label="Best" value={fixed(report.bestRating)} tint={color.gold} />
        <Tile label="Average" value={fixed(report.averageRating)} />
        <Tile label="Median" value={fixed(report.medianRating)} />
        <Tile label="Spread" value={report.ratingSpread === null ? '—' : `±${report.ratingSpread.toFixed(1)}`} />
      </View>

      {report.counted > 0 ? (
        <>
          <View style={styles.segmented}>
            <Segment label="Spread" on={view === 'spread'} onPress={() => setView('spread')} />
            <Segment
              label="Percentiles"
              on={view === 'percentiles'}
              onPress={() => setView('percentiles')}
            />
          </View>

          <View style={styles.chart} onLayout={onLayout}>
            {view === 'spread' ? (
              <Spread report={report} width={width} />
            ) : (
              <Percentiles report={report} width={width} />
            )}
          </View>
          <Axis report={report} />
          <Text style={styles.caption}>{caption(report, view)}</Text>
        </>
      ) : (
        <Text style={styles.caption}>
          Every season so far used the rigged spin, so none of them can set a record.
        </Text>
      )}

      {report.form.length >= 2 ? <Form report={report} /> : null}
      {report.modes.length > 0 ? <Modes report={report} /> : null}

      <View style={styles.rows}>
        <Row
          label="Builds with"
          value={report.topFranchise ? franchise(report.topFranchise).name : '—'}
          note={share(report.topFranchisePicks, report.picks)}
        />
        <Row
          label="Favourite era"
          value={report.topEra ? eraLabel(report.topEra) : '—'}
          note={share(report.topEraPicks, report.picks)}
        />
        <Row
          label="Highest pick"
          value={report.bestCard?.name ?? '—'}
          note={report.bestCard ? report.bestCard.rating.toFixed(1) : undefined}
        />
        <Row
          label="Aggregate record"
          value={report.counted > 0 ? `${report.wins}-${report.losses}` : '—'}
          note={report.counted > 0 ? `${Math.round((report.wins / (report.wins + report.losses)) * 100)}% won` : undefined}
        />
      </View>
    </GlassSurface>
  );
}

/* -------------------------------------------------------------------------- */
/* The two views of one histogram                                             */
/* -------------------------------------------------------------------------- */

/**
 * Counts per bucket, with the bucket holding your best in gold.
 *
 * Bars rather than a curve: twenty-five buckets over fifty rating points is
 * coarse enough that a smoothed line would invent shape the data does not have.
 */
function Spread({ report, width }: { report: CareerReport; width: number }) {
  const bars = useMemo(() => {
    if (width <= 0) return [];
    const n = report.histogram.length;
    const gap = 2;
    const bw = Math.max(1, (width - gap * (n - 1)) / n);
    let tallest = 1;
    for (let i = 0; i < n; i++) tallest = Math.max(tallest, report.histogram[i]!);
    const bestBucket =
      report.bestRating === null
        ? -1
        : Math.min(n - 1, Math.floor((report.bestRating - report.bucketFloor) / report.bucketSpan));

    return report.histogram.map((count, i) => ({
      key: i,
      x: i * (bw + gap),
      w: bw,
      // A bucket with one season in it must still be visible, or a player's
      // only 96 is a gap in the chart where their best season should be.
      h: count === 0 ? 0 : Math.max(3, (count / tallest) * CHART_HEIGHT),
      best: i === bestBucket,
    }));
  }, [report, width]);

  const median = useMemo(() => xFor(report, report.medianRating, width), [report, width]);

  if (width <= 0) return null;

  return (
    <Svg width="100%" height={CHART_HEIGHT} viewBox={`0 0 ${width} ${CHART_HEIGHT}`} {...DECORATIVE}>
      {bars.map((bar) => (
        <Rect
          key={bar.key}
          x={bar.x}
          y={CHART_HEIGHT - bar.h}
          width={bar.w}
          height={bar.h}
          rx={Math.min(2, bar.w / 2)}
          fill={bar.best ? color.gold : color.ice}
          opacity={bar.best ? 0.95 : 0.6}
        />
      ))}
      {median === null ? null : (
        <Path
          d={`M ${median} 0 L ${median} ${CHART_HEIGHT}`}
          stroke={color.text}
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.65}
        />
      )}
    </Svg>
  );
}

/**
 * The same buckets as a running total, which is the curve the quantiles live on.
 *
 * p10, p50 and p90 are marked because they are the three that answer "what is a
 * normal season for me" -- and each of them is one walk of twenty-five numbers,
 * not a sort.
 */
function Percentiles({ report, width }: { report: CareerReport; width: number }) {
  const shape = useMemo(() => {
    if (width <= 0 || report.counted === 0) return null;
    const run = cumulative(report.histogram);
    const n = run.length;
    const points: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = ((i + 1) / n) * width;
      const y = CHART_HEIGHT - (run[i]! / report.counted) * CHART_HEIGHT;
      points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    const line = `M 0 ${CHART_HEIGHT} L ${points.join(' L ')}`;
    return { line, area: `${line} L ${width} ${CHART_HEIGHT} Z` };
  }, [report, width]);

  const marks = useMemo(() => {
    const out: { q: number; x: number }[] = [];
    for (const q of [0.1, 0.5, 0.9]) {
      const x = xFor(report, quantile(report, q), width);
      if (x !== null) out.push({ q, x });
    }
    return out;
  }, [report, width]);

  if (!shape) return null;

  return (
    <Svg width="100%" height={CHART_HEIGHT} viewBox={`0 0 ${width} ${CHART_HEIGHT}`} {...DECORATIVE}>
      <Defs>
        <LinearGradient id="cdf-fill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color.ice} stopOpacity="0.30" />
          <Stop offset="1" stopColor={color.ice} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>
      {marks.map((mark) => (
        <Path
          key={mark.q}
          d={`M ${mark.x} 0 L ${mark.x} ${CHART_HEIGHT}`}
          stroke={color.lineBright}
          strokeWidth={1}
          strokeDasharray="2 4"
        />
      ))}
      <Path d={shape.area} fill="url(#cdf-fill)" />
      <Path d={shape.line} stroke={color.ice} strokeWidth={2} fill="none" />
      {marks.map((mark) => (
        <Circle
          key={mark.q}
          cx={mark.x}
          cy={CHART_HEIGHT - mark.q * CHART_HEIGHT}
          r={3}
          fill={color.ice}
        />
      ))}
    </Svg>
  );
}

/** The rating scale under both charts, so a bar means a number. */
function Axis({ report }: { report: CareerReport }) {
  const top = report.bucketFloor + report.histogram.length * report.bucketSpan;
  const mid = (report.bucketFloor + top) / 2;
  return (
    <View style={styles.axis}>
      <Text style={styles.axisLabel}>{report.bucketFloor}</Text>
      <Text style={styles.axisLabel}>{mid}</Text>
      <Text style={styles.axisLabel}>{top}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Form, modes, tendencies                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The last twelve counted seasons against the career average.
 *
 * The line alone says nothing -- twelve ratings between 78 and 86 look dramatic
 * on any scale you choose. The baseline is what makes it readable: above the
 * dashes is better than you usually are.
 */
function Form({ report }: { report: CareerReport }) {
  const [width, onLayout] = useWidth();

  const shape = useMemo(() => {
    const form = report.form;
    if (width <= 0 || form.length < 2) return null;

    let low = form[0]!;
    let high = form[0]!;
    let total = 0;
    for (let i = 0; i < form.length; i++) {
      const value = form[i]!;
      if (value < low) low = value;
      if (value > high) high = value;
      total += value;
    }
    const average = report.averageRating ?? total / form.length;
    // The baseline has to be inside the drawn range or it sits on an edge and
    // reads as the axis rather than as the comparison.
    low = Math.min(low, average);
    high = Math.max(high, average);
    const span = Math.max(1, high - low);

    const pad = 4;
    const usable = FORM_HEIGHT - pad * 2;
    const y = (value: number) => pad + (1 - (value - low) / span) * usable;
    // Inset by the dot's radius at both ends. Drawn edge to edge, the marker on
    // the newest season -- the one point anybody looks for -- was half outside
    // the box and read as a stray tick.
    const x = (i: number) =>
      form.length === 1 ? width / 2 : DOT + (i / (form.length - 1)) * (width - DOT * 2);

    const points = form.map((value, i) => `${x(i).toFixed(2)} ${y(value).toFixed(2)}`);
    return {
      line: `M ${points.join(' L ')}`,
      baseline: y(average),
      last: { x: x(form.length - 1), y: y(form[form.length - 1]!) },
      recent: total / form.length,
    };
  }, [report, width]);

  const delta = shape && report.averageRating !== null ? shape.recent - report.averageRating : null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Last {report.form.length}</Text>
        {delta === null ? null : (
          <Text
            style={[
              styles.delta,
              { color: delta >= 0 ? color.positive : color.negative },
            ]}
          >
            {delta >= 0 ? '+' : '−'}
            {Math.abs(delta).toFixed(1)} on career
          </Text>
        )}
      </View>
      <View style={styles.form} onLayout={onLayout}>
        {shape ? (
          <Svg
            width="100%"
            height={FORM_HEIGHT}
            viewBox={`0 0 ${width} ${FORM_HEIGHT}`}
            {...DECORATIVE}
          >
            <Path
              d={`M 0 ${shape.baseline} L ${width} ${shape.baseline}`}
              stroke={color.textFaint}
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            <Path d={shape.line} stroke={color.ice} strokeWidth={2} fill="none" />
            <Circle cx={shape.last.x} cy={shape.last.y} r={DOT} fill={color.gold} />
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

/** Which modes the seasons were built in, as one bar. */
function Modes({ report }: { report: CareerReport }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Modes</Text>
      <View style={styles.split}>
        {report.modes.map((entry) => (
          <View
            key={entry.mode}
            style={{
              flexGrow: entry.count,
              flexBasis: 0,
              backgroundColor: modeTint(entry.mode),
              opacity: 0.85,
            }}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {report.modes.map((entry) => (
          <View key={entry.mode} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: modeTint(entry.mode) }]} />
            <Text style={styles.legendLabel}>
              {MODE_LABEL[entry.mode as GameMode] ?? entry.mode}
            </Text>
            <Text style={styles.legendValue}>{entry.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

function Tile({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function Segment({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={on ? undefined : onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`Show ${label.toLowerCase()}`}
      style={({ hovered, pressed }: PressState) => [
        styles.segment,
        on && styles.segmentOn,
        hovered && !on && styles.segmentHover,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]}>{label}</Text>
    </Pressable>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
        {note ? <Text style={styles.rowNote}>{note}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Where a rating sits along the chart, in points.
 *
 * Both charts span the whole bucket range rather than the ratings actually
 * present, so a marker computed from the range would move every time a season
 * landed. Null when there is nothing to place.
 */
function xFor(report: CareerReport, rating: number | null, width: number): number | null {
  if (rating === null || width <= 0) return null;
  const span = report.histogram.length * report.bucketSpan;
  const at = (rating - report.bucketFloor) / span;
  return Math.min(1, Math.max(0, at)) * width;
}

/** The sentence under the chart. Both halves are quantile reads, not walks. */
function caption(report: CareerReport, view: ChartView): string {
  if (view === 'spread') {
    const low = quantile(report, 0.25);
    const high = quantile(report, 0.75);
    if (low === null || high === null) return '';
    return `Half your seasons land between ${low.toFixed(1)} and ${high.toFixed(1)}.`;
  }
  const latest = report.form[report.form.length - 1];
  if (latest === undefined) return '';
  const beat = percentileOf(report, latest);
  if (beat === null) return '';
  return `Your last counted season, ${latest.toFixed(1)}, sits above ${Math.round(beat * 100)}% of the rest.`;
}

/**
 * A colour per mode, read at render.
 *
 * Not a module-scope map: `color` is mutated in place when the theme changes and
 * a map built at import would hold the palette that happened to load first.
 */
function modeTint(mode: string): string {
  if (mode === 'player_iq') return color.ice;
  if (mode === 'gameday') return color.gold;
  if (mode === 'scout') return color.silver;
  return color.action;
}

const fixed = (value: number | null) => (value === null ? '—' : value.toFixed(1));

const share = (part: number, whole: number) =>
  whole > 0 && part > 0 ? `${Math.round((part / whole) * 100)}%` : undefined;

const styles = themed(() => StyleSheet.create({
  panel: { padding: space.lg, gap: space.md },

  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  eyebrow: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  headCount: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },

  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, minWidth: 0 },
  tileValue: {
    fontFamily: font.display,
    fontSize: 24,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  tileLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textFaint,
  },

  segmented: { flexDirection: 'row', gap: space.xs, alignSelf: 'flex-start' },
  segment: {
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF06',
  },
  segmentHover: { borderColor: color.lineBright, backgroundColor: '#FFFFFF0D' },
  segmentOn: { borderColor: color.lineBright, backgroundColor: '#FFFFFF16' },
  segmentLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  segmentLabelOn: { color: color.text },

  chart: { height: CHART_HEIGHT },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -space.xs },
  axisLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    ...tabular,
  },
  caption: { fontFamily: font.bodyRegular, fontSize: 11, lineHeight: 16, color: color.textFaint },

  section: { gap: space.xs },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  delta: { fontFamily: font.body, fontSize: 11, ...tabular },
  form: { height: FORM_HEIGHT },

  split: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF0A',
  },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textDim },
  legendValue: { fontFamily: font.body, fontSize: 11, color: color.text, ...tabular },

  rows: { marginTop: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  rowLabel: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textDim },
  rowRight: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexShrink: 1 },
  rowValue: { fontFamily: font.body, fontSize: 12, color: color.text, flexShrink: 1, textAlign: 'right' },
  rowNote: { fontFamily: font.label, fontSize: 10, letterSpacing: tracking.normal, color: color.textFaint, ...tabular },
}));
