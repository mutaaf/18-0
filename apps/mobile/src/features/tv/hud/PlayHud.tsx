import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, ReduceMotion, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROSTER_SLOTS, type RosterSlot } from '@17-0/domain';
import { DATASET, displayName, era as eraDef, franchise, franchiseEraShape, franchiseEraStory, type BootCard } from '@17-0/data';
import { useCardStats } from '@/features/stat-lines';
import { MODE_LABEL, lookupCard, showsRating, showsStats, type GameMode } from '@/state/game';
import { computeStats, useHistoryStore } from '@/state/history';
import { DECORATIVE, color, font, positionColor, radius, space, tabular, themed, tracking } from '@/theme';
import { cue } from '../sound';
import { useTVPrefs } from '../prefs';
import { HudPanel, useBroadcast, useWipe } from './kit';

/**
 * The play screen's broadcast graphics: scorebug, lower thirds, crawl.
 *
 * Display only. It reads the same store the screen reads and writes nothing;
 * a rating is shown only in the mode that already shows ratings, so a
 * broadcast of a Scout or GM Mode season leaks nothing the player cannot see.
 */
export interface PlayHudProps {
  mode: GameMode;
  selections: readonly { slot: RosterSlot; cardId: string }[];
  /** The landed spin while a pick is open; null while spinning or between spins. */
  landed: { franchiseId: string; era: string; sequence: number } | null;
}

const LOWER_THIRD_MS = 6000;

export function PlayHud(props: PlayHudProps) {
  const on = useBroadcast();
  if (!on) return null;
  return <Hud {...props} />;
}

function Hud({ mode, selections, landed }: PlayHudProps) {
  const insets = useSafeAreaInsets();
  const ticker = useTVPrefs((s) => s.ticker);

  // Which lower third is up: the spin that just landed, or the pick that just
  // locked. Newest wins; each holds for six seconds and wipes off.
  const [third, setThird] = useState<{ kind: 'spin' | 'pick'; key: string } | null>(null);
  const lastSpin = useRef<number | null>(null);
  const lastPicks = useRef(selections.length);
  useEffect(() => {
    if (landed && landed.sequence !== lastSpin.current) {
      lastSpin.current = landed.sequence;
      setThird({ kind: 'spin', key: `s${landed.sequence}` });
      cue('wipe');
    }
  }, [landed]);
  useEffect(() => {
    if (selections.length > lastPicks.current) {
      setThird({ kind: 'pick', key: `p${selections.length}` });
      cue('wipe');
    }
    lastPicks.current = selections.length;
  }, [selections.length]);
  useEffect(() => {
    if (!third) return;
    const at = setTimeout(() => setThird((t) => (t?.key === third.key ? null : t)), LOWER_THIRD_MS);
    return () => clearTimeout(at);
  }, [third]);

  const lastPick = selections[selections.length - 1];
  const pickCard = lastPick ? lookupCard(lastPick.cardId) : undefined;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" {...DECORATIVE}>
      {/* In the band above the lineup, where its heading was, not over the field. */}
      <View style={[styles.bugSeat, { top: Math.max(space.sm, insets.top - 28), left: insets.left }]}>
        <Scorebug mode={mode} selections={selections} />
      </View>

      <View style={[styles.thirdSeat, { left: insets.left + space.lg, bottom: insets.bottom + (ticker ? 40 : space.lg) }]}>
        {third?.kind === 'spin' && landed ? (
          <SpinThird key={third.key} franchiseId={landed.franchiseId} era={landed.era} pick={selections.length + 1} />
        ) : null}
        {third?.kind === 'pick' && pickCard && lastPick ? (
          <PickThird key={third.key} card={pickCard} slot={lastPick.slot} mode={mode} />
        ) : null}
      </View>

      {ticker ? (
        <View style={[styles.tickerSeat, { bottom: Math.max(4, insets.bottom - 34), left: 0, right: 0 }]}>
          <Ticker mode={mode} picks={selections.length} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The scorebug: the lens, seven pips, and the running number.
 *
 * The running number is the average rating of the picks so far, and only in
 * Rookie -- the one mode whose cards show a rating. It is labelled as an
 * average because it is one: the season's rating is the model's, with its
 * weak-link and depth terms, and is announced by the reveal, not guessed here.
 */
function Scorebug({ mode, selections }: { mode: GameMode; selections: PlayHudProps['selections'] }) {
  const p = useWipe(true, 150);
  const picks = selections.length;
  const ratings = selections.map((s) => lookupCard(s.cardId)?.rating ?? 0);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const filled = new Set(selections.map((s) => s.slot));
  return (
    <HudPanel progress={p}>
      <View style={styles.bug}>
        <View style={styles.bugBrand}>
          <Text style={styles.bugBrandText}>
            17<Text style={{ color: color.gold }}>-</Text>0
          </Text>
        </View>
        <View style={styles.bugCell}>
          <Text style={styles.bugLabel}>Lens</Text>
          <Text style={styles.bugValue}>{MODE_LABEL[mode]}</Text>
        </View>
        <View style={styles.bugCell}>
          <Text style={styles.bugLabel}>Picks</Text>
          <View style={styles.pips}>
            {ROSTER_SLOTS.map((slot) => (
              <View key={slot} style={[styles.pip, filled.has(slot) && styles.pipOn]} />
            ))}
            <Text style={[styles.bugValue, styles.bugCount]}>
              {picks}/{ROSTER_SLOTS.length}
            </Text>
          </View>
        </View>
        <View style={[styles.bugCell, styles.bugLast]}>
          <Text style={styles.bugLabel}>{showsRating(mode) ? 'Avg pick' : 'Ratings'}</Text>
          <Text style={[styles.bugValue, showsRating(mode) && avg !== null && { color: color.goldBright }]}>
            {showsRating(mode) ? (avg === null ? '—' : avg.toFixed(1)) : 'Hidden'}
          </Text>
        </View>
      </View>
    </HudPanel>
  );
}

function SpinThird({ franchiseId, era, pick }: { franchiseId: string; era: string; pick: number }) {
  const p = useWipe(true, 80);
  const team = franchise(franchiseId);
  const def = eraDef(era as never);
  const story = franchiseEraStory(franchiseId, era as never) || franchiseEraShape(franchiseId, era as never);
  return (
    <HudPanel progress={p} accent={color.action}>
      <View style={styles.third}>
        <Text style={styles.thirdKicker}>
          Spin {Math.min(pick, ROSTER_SLOTS.length)} of {ROSTER_SLOTS.length}
        </Text>
        <Text style={styles.thirdTitle}>
          {team.name} <Text style={styles.thirdTitleDim}>· {def.label}</Text>
        </Text>
        {story ? (
          <Text style={styles.thirdLine} numberOfLines={1}>
            {story}
          </Text>
        ) : null}
      </View>
    </HudPanel>
  );
}

function PickThird({ card, slot, mode }: { card: BootCard; slot: RosterSlot; mode: GameMode }) {
  const p = useWipe(true, 80);
  const stats = useCardStats(card);
  const team = franchise(card.franchiseId);
  const accent = positionColor[card.position];
  const line = showsStats(mode) ? stats.slice(0, 3).map((s) => `${s.value} ${s.label}`).join('   ') : `${team.name} · ${card.year}`;
  return (
    <HudPanel progress={p} accent={accent}>
      <View style={styles.third}>
        <Text style={[styles.thirdKicker, { color: accent }]}>
          {slot} · Locked in
        </Text>
        <Text style={styles.thirdTitle}>
          {displayName(card)}{' '}
          <Text style={styles.thirdTitleDim}>
            · {team.abbr} {card.year}
          </Text>
          {showsRating(mode) ? <Text style={{ color: color.goldBright }}>  {card.rating.toFixed(1)}</Text> : null}
        </Text>
        <Text style={styles.thirdLine} numberOfLines={1}>
          {line}
        </Text>
      </View>
    </HudPanel>
  );
}

/**
 * The crawl. One linear Reanimated repeat on the UI thread, measured once
 * from the text's own width, so it costs the JS thread nothing while it runs.
 */
export function Ticker({ mode, picks }: { mode: GameMode; picks: number }) {
  const games = useHistoryStore((s) => s.games);
  const stats = useMemo(() => computeStats(games), [games]);
  const items = useMemo(
    () =>
      [
        `${DATASET.cards.length.toLocaleString()} rated seasons, ${DATASET.coverage.firstSeason}–${DATASET.coverage.lastSeason}`,
        `${DATASET.combos.length} franchise-eras on the wheel`,
        '17-0 lands about once every 6,000 seasons',
        '16-1 about once every 49',
        `Now playing: ${MODE_LABEL[mode]} · pick ${Math.min(picks + 1, ROSTER_SLOTS.length)} of ${ROSTER_SLOTS.length}`,
        stats.bestRecord ? `Best on this TV: ${stats.bestRecord.wins}-${stats.bestRecord.losses}` : 'No seasons on this TV yet',
        stats.perfectSeasons ? `${stats.perfectSeasons} perfect ${stats.perfectSeasons === 1 ? 'season' : 'seasons'} here` : null,
        'Seven spins · one pick each · no rerolls',
      ].filter(Boolean) as string[],
    [mode, picks, stats],
  );
  const text = items.join('     ◆     ');
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (!width) return;
    x.value = 0;
    x.value = withRepeat(withTiming(-width, { duration: width * 22, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false);
    return () => cancelAnimation(x);
  }, [width, x]);
  const roll = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={styles.ticker}>
      <View style={styles.tickerTag}>
        <Text style={styles.tickerTagText}>17-0</Text>
      </View>
      <View style={styles.tickerTrack}>
        <Animated.View style={[styles.tickerRoll, roll]}>
          <Text style={styles.tickerText} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
            {text}
            {'     ◆     '}
          </Text>
          <Text style={styles.tickerText}>
            {text}
            {'     ◆     '}
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    bugSeat: { position: 'absolute' },
    bug: { flexDirection: 'row', alignItems: 'stretch' },
    bugBrand: { backgroundColor: color.action, paddingHorizontal: space.md, justifyContent: 'center' },
    bugBrandText: { fontFamily: font.display, fontSize: 22, color: color.onAction, ...tabular },
    bugCell: {
      paddingHorizontal: space.md,
      paddingVertical: 5,
      borderRightWidth: 1,
      borderRightColor: color.line,
      justifyContent: 'center',
    },
    bugLast: { borderRightWidth: 0 },
    bugLabel: { fontFamily: font.label, fontSize: 9, letterSpacing: tracking.wider, textTransform: 'uppercase', color: color.textDim },
    bugValue: { fontFamily: font.display, fontSize: 18, lineHeight: 20, color: color.text, ...tabular },
    bugCount: { marginLeft: space.xs },
    pips: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    pip: { width: 8, height: 12, borderRadius: 2, backgroundColor: color.line },
    pipOn: { backgroundColor: color.action },

    thirdSeat: { position: 'absolute', maxWidth: 620 },
    // A floor on the width, so a short name does not leave the slot behind it
    // peeking out round the end of the graphic.
    third: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: 1, minWidth: 360 },
    thirdKicker: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wider, textTransform: 'uppercase', color: color.actionBright },
    thirdTitle: { fontFamily: font.display, fontSize: 26, lineHeight: 28, color: color.text },
    thirdTitleDim: { color: color.silver },
    thirdLine: { fontFamily: font.body, fontSize: 13, color: color.silver },

    tickerSeat: { position: 'absolute', height: 28 },
    ticker: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'stretch',
      backgroundColor: color.glass,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: color.lineBright,
    },
    tickerTag: { backgroundColor: color.action, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.sm },
    tickerTagText: { fontFamily: font.display, fontSize: 15, color: color.onAction, letterSpacing: tracking.wide },
    tickerTrack: { flex: 1, overflow: 'hidden', justifyContent: 'center' },
    // Wide enough that the text lays out at its own width rather than wrapping
    // to the track's.
    tickerRoll: { flexDirection: 'row', position: 'absolute', left: space.md, width: 40000 },
    tickerText: { flexShrink: 0, fontFamily: font.label, fontSize: 14, letterSpacing: tracking.normal, color: color.text },
  }),
);
