import { forwardRef, type ComponentProps } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { GameResult, RosterSlot } from '@18-0/domain';
import { APP_URL_LABEL } from '@/features/share';
import { color, font, positionColor, radius, space, tabular, tierColor, tracking } from '@/theme';

/**
 * The card is a fixed 540x675 canvas that gets captured to a PNG, so its text
 * must not follow the system font scale — at 200% the record digits and roster
 * columns clip straight out of the exported image.
 */
const Text = (props: ComponentProps<typeof RNText>) => <RNText allowFontScaling={false} {...props} />;

export interface ShareRosterRow {
  readonly slot: RosterSlot;
  readonly name: string;
  readonly abbr: string;
  readonly year: number;
  readonly rating: number;
  readonly position: keyof typeof positionColor;
}

/**
 * The share card (PRFAQ §32).
 *
 * Rendered at a fixed 1080×1350 logical size and captured to an image, so it
 * looks identical wherever it lands. 18-0 gets a visually distinct treatment —
 * the whole point of the chase is that the artifact proves it.
 */
export const ShareCard = forwardRef<View, {
  result: GameResult;
  roster: readonly ShareRosterRow[];
  assisted?: boolean;
}>(function ShareCard({ result, roster, assisted }, ref) {
  const perfect = result.ending.key === 'PERFECT';
  const accent = perfect ? color.gold : tierColor[result.ending.tier] ?? color.text;

  return (
    <View ref={ref} collapsable={false} style={[styles.card, perfect && styles.cardPerfect]}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 540 675" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={perfect ? '#1B1503' : '#0C1219'} />
            <Stop offset="1" stopColor="#07090C" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="540" height="675" fill="url(#bg)" />
        {Array.from({ length: 9 }, (_, i) => (i + 1) * 67).map((y) => (
          <Line key={y} x1="0" y1={y} x2="540" y2={y} stroke="#FFFFFF" strokeWidth="0.6" opacity="0.05" />
        ))}
      </Svg>

      <View style={styles.head}>
        <View style={styles.lockup}>
          <Text style={styles.mark}>18</Text>
          <View style={styles.markDash} />
          <Text style={styles.mark}>0</Text>
        </View>
        <Text style={styles.headMeta}>NFL HISTORY ROSTER GAME</Text>
      </View>

      <View style={styles.hero}>
        <Text style={styles.kicker}>Projected Record</Text>
        <View style={styles.recordRow}>
          <Text style={[styles.record, perfect && { color: color.goldBright }]}>{result.record.wins}</Text>
          <View style={[styles.recordDash, { backgroundColor: accent }]} />
          <Text style={[styles.record, perfect && { color: color.goldBright }]}>{result.record.losses}</Text>
        </View>
        <Text style={[styles.ending, { color: accent }]}>
          {perfect ? 'PERFECT · IMMORTAL' : result.ending.label.toUpperCase()}
        </Text>
        <Text style={styles.rating}>
          {result.finalRating.toFixed(1)} <Text style={styles.ratingLabel}>18-0 RATING</Text>
          <Text style={styles.ratingLabel}>   ·   TIER </Text>
          <Text style={{ color: accent }}>{result.ending.tier}</Text>
        </Text>
      </View>

      <View style={styles.roster}>
        {roster.map((row) => (
          <View key={row.slot} style={styles.row}>
            <Text style={[styles.slot, { color: positionColor[row.position] }]}>{row.slot}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {row.name}
            </Text>
            <Text style={styles.meta}>
              {row.abbr} '{String(row.year).slice(2)}
            </Text>
            <Text style={styles.rowRating}>{row.rating.toFixed(1)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.foot}>
        {assisted ? <Text style={styles.assisted}>ASSISTED RUN</Text> : null}
        <Text style={styles.cta}>
          {perfect ? 'A perfect season. Beat it.' : 'Can you beat this roster?'}
        </Text>
        {/* Android's file share drops any caption, so the image has to carry the
            link itself or the share is a dead end. */}
        <View style={[styles.urlBar, perfect && { borderColor: '#F2C43D80' }]}>
          <Text style={[styles.url, perfect && { color: color.goldBright }]}>{PLAY_AT}</Text>
        </View>
        <Text style={styles.footNote}>
          Deterministic scoring · model {result.ratingModelVersion} · same roster, same record
        </Text>
      </View>
    </View>
  );
});

/** Read as a URL without the scheme noise, the way a broadcast lower-third would. */
const PLAY_AT = `PLAY AT ${APP_URL_LABEL.toUpperCase()}`;

export const SHARE_CARD_SIZE = { width: 540, height: 675 };

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_SIZE.width,
    height: SHARE_CARD_SIZE.height,
    backgroundColor: color.void,
    padding: 34,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  cardPerfect: { borderWidth: 2, borderColor: '#F2C43D66' },
  urlBar: {
    marginTop: 8,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  url: {
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: tracking.wide,
    color: color.silver,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lockup: { flexDirection: 'row', alignItems: 'center' },
  mark: { fontFamily: font.displayBlack, fontSize: 30, color: color.text, includeFontPadding: false },
  markDash: { width: 11, height: 4, borderRadius: 2, backgroundColor: color.red, marginHorizontal: 4 },
  headMeta: { fontFamily: font.label, fontSize: 9, letterSpacing: tracking.wider, color: color.textFaint },
  hero: { alignItems: 'center' },
  kicker: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  record: {
    fontFamily: font.displayBlack,
    fontSize: 108,
    lineHeight: 112,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
    ...tabular,
  },
  recordDash: { width: 30, height: 8, borderRadius: 4 },
  ending: { fontFamily: font.display, fontSize: 24, letterSpacing: tracking.wide, marginTop: -6 },
  rating: { fontFamily: font.heading, fontSize: 15, color: color.text, marginTop: 8 },
  ratingLabel: { fontFamily: font.label, fontSize: 10, letterSpacing: tracking.wide, color: color.textFaint },
  roster: { gap: 3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: '#FFFFFF08',
  },
  slot: { fontFamily: font.label, fontSize: 11, width: 36, letterSpacing: tracking.wide },
  name: { flex: 1, fontFamily: font.heading, fontSize: 16, color: color.text },
  meta: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, width: 58, textAlign: 'right' },
  rowRating: { fontFamily: font.display, fontSize: 16, color: color.text, width: 44, textAlign: 'right', ...tabular },
  foot: { alignItems: 'center', gap: 3 },
  assisted: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
    color: color.textDim,
  },
  cta: { fontFamily: font.display, fontSize: 19, letterSpacing: tracking.wide, color: color.text },
  footNote: { fontFamily: font.bodyRegular, fontSize: 9, color: color.textFaint },
});
