import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { POSITIONS, ROSTER_SLOTS, SLOT_POSITION, type Position, type RosterSlot } from '@18-0/domain';
import { DATASET, displayName, eligibleCards, era as eraDef, franchise, type DatasetCard } from '@18-0/data';
import { Brand } from '@/components/Brand';
import { Field } from '@/components/Field';
import { SpinReel } from '@/components/SpinReel';
import { PlayerRow } from '@/components/PlayerRow';
import { Screen } from '@/components/Screen';
import { lookupCard, slotsForCard, useGameStore } from '@/state/game';
import { useHistoryStore } from '@/state/history';
import { color, font, positionColor, radius, space, tracking, useLayout, type PressState } from '@/theme';

/** How many names blur past before the reel settles on the result. */
const REEL_LENGTH = 18;

export default function Play() {
  const router = useRouter();
  const layout = useLayout();
  const game = useGameStore();
  const record = useHistoryStore((s) => s.record);

  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<{ teams: string[]; eras: string[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [positionFilter, setPositionFilter] = useState<Position | 'ALL'>('ALL');
  const [notice, setNotice] = useState<string | null>(null);
  const [lastPick, setLastPick] = useState<{ card: DatasetCard; slot: RosterSlot } | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [assistArmed, setAssistArmed] = useState(false);
  const [targetSlot, setTargetSlot] = useState<RosterSlot | null>(null);
  /** Live touch count, for the three-finger spin. */
  const fingers = useRef(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  useEffect(() => {
    if (game.status === 'idle') game.startGame();
  }, [game.status]);

  const spin = game.spins[game.spins.length - 1] ?? null;
  const complete = game.selections.length >= ROSTER_SLOTS.length;

  /**
   * One selection per spin (PRFAQ §6). Once a pick is made the eligible list
   * closes — the only way to fill another slot is to spin again and live with
   * whatever the wheel gives you. That constraint is the whole game.
   */
  const canPick = game.status === 'spun' && !complete;
  /** Player IQ mode: no ratings, no stats, no detail screen to peek at. */
  const blind = game.mode === 'player_iq';

  const filled = useMemo(
    () =>
      Object.fromEntries(game.selections.map((s) => [s.slot, lookupCard(s.cardId)])) as Partial<
        Record<RosterSlot, DatasetCard>
      >,
    [game.selections],
  );
  const abbrs = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(filled).map(([slot, card]) => [slot, card ? franchise(card.franchiseId).abbr : '']),
      ) as Partial<Record<RosterSlot, string>>,
    [filled],
  );

  const eligible = useMemo(
    () => (spin && canPick ? eligibleCards(spin.franchiseId, spin.era) : []),
    [spin, canPick],
  );

  const openPositions = useMemo(() => {
    const open = new Set<Position>();
    for (const slotKey of ROSTER_SLOTS) {
      if (!filled[slotKey]) open.add(slotKey === 'DEF' ? 'DEF' : (slotKey.replace(/\d/g, '') as Position));
    }
    return open;
  }, [filled]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return eligible.filter((card) => {
      if (positionFilter !== 'ALL' && card.position !== positionFilter) return false;
      if (!needle) return true;
      return displayName(card).toLowerCase().includes(needle) || String(card.year).includes(needle);
    });
  }, [eligible, positionFilter, query]);

  const selected = selectedId ? eligible.find((c) => c.id === selectedId) ?? null : null;
  const targetSlots = selected ? slotsForCard(selected, game.selections) : [];

  /**
   * The three-finger spin: hold three fingers anywhere on the screen while
   * tapping Spin and the wheel lands on the best card still available. On a
   * pointer device the equivalent is Shift-click.
   */
  const trackTouches = useCallback((count: number) => {
    fingers.current = count;
    setAssistArmed(count >= 3);
  }, []);

  const doSpin = useCallback((event?: { shiftKey?: boolean }) => {
    if (spinning || complete) return;
    const assist = fingers.current >= 3 || event?.shiftKey === true;
    setSelectedId(null);
    setNotice(null);
    setLastPick(null);
    setTargetSlot(null);
    setQuery('');
    setPositionFilter('ALL');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    const land = () => {
      const result = game.spin({ assist });
      if (!result) {
        setNotice('No franchise-era left with a player for your open slots.');
        return null;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return result;
    };

    // The result is decided first and the reel travels toward it, rather than
    // the animation deciding the outcome. Cheaper, and it means Reduce Motion
    // shows the same spin without the theatre.
    const result = land();
    if (!result || reduceMotion) return;

    const decoys = Array.from({ length: REEL_LENGTH }, () => {
      const combo = DATASET.combos[Math.floor(Math.random() * DATASET.combos.length)]!;
      return combo;
    });
    setReel({
      teams: [...decoys.map((c) => franchise(c.franchiseId).abbr), franchise(result.franchiseId).abbr],
      eras: [...decoys.map((c) => eraDef(c.era).name), eraDef(result.era).name],
    });
    setSpinning(true);
  }, [complete, game, reduceMotion, spinning]);

  const assign = useCallback(
    (card: DatasetCard, slot: RosterSlot) => {
      const outcome = game.select(card, slot);
      if (!outcome.ok) {
        setNotice(outcome.message);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});
      setSelectedId(null);
      setNotice(null);
      setTargetSlot(null);
      setPositionFilter('ALL');
      setLastPick({ card, slot });
    },
    [game],
  );

  /**
   * Filling a position by tapping it on the field. Choosing the slot first and
   * the player second is how people actually think about a lineup — and it
   * removes the second tap that the RB1/RB2 picker used to need.
   */
  const pressSlot = useCallback(
    (slot: RosterSlot) => {
      if (!canPick || filled[slot]) return;
      const next = targetSlot === slot ? null : slot;
      setTargetSlot(next);
      setPositionFilter(next ? SLOT_POSITION[slot] : 'ALL');
      setSelectedId(null);
      Haptics.selectionAsync().catch(() => {});
    },
    [canPick, filled, targetSlot],
  );

  const reveal = useCallback(() => {
    const result = game.complete();
    if (!result) return;
    record({
      id: `${game.startedAt ?? Date.now()}`,
      completedAt: Date.now(),
      result,
      assisted: game.assisted,
      mode: game.mode,
      roster: game.selections.map((s) => {
        const card = lookupCard(s.cardId)!;
        return {
          slot: s.slot,
          cardId: s.cardId,
          name: displayName(card),
          franchiseId: card.franchiseId,
          era: card.era,
          year: card.year,
          rating: card.rating,
        };
      }),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.replace('/result');
  }, [game, record, router]);

  const shown = spin && canPick ? { franchiseId: spin.franchiseId, era: spin.era } : null;
  const team = shown ? franchise(shown.franchiseId) : null;
  const remaining = ROSTER_SLOTS.length - game.selections.length;

  // --- pieces, composed differently per breakpoint -------------------------

  const spinPanel = (
    <View style={styles.stack}>
      <View style={styles.spinRow}>
        <View style={[styles.spinCard, styles.teamCard, layout.roomy && styles.spinCardRoomy]}>
          <Text style={[styles.spinLabel, { color: color.red }]}>Team</Text>
          {spinning && reel ? (
            <SpinReel
              items={reel.teams}
              itemHeight={layout.roomy ? 46 : 38}
              spinning={spinning}
              textStyle={StyleSheet.flatten([styles.spinValue, layout.roomy && styles.spinValueRoomy])}
            />
          ) : (
            <Text style={[styles.spinValue, layout.roomy && styles.spinValueRoomy]} numberOfLines={1}>
              {team ? team.abbr : '—'}
            </Text>
          )}
          <Text style={styles.spinSub} numberOfLines={1}>
            {spinning ? 'Spinning…' : team ? team.nick : 'Awaiting spin'}
          </Text>
        </View>
        <View style={[styles.spinCard, styles.eraCard, layout.roomy && styles.spinCardRoomy]}>
          <Text style={[styles.spinLabel, { color: '#B47CFF' }]}>
            Era{shown ? ` · ${eraDef(shown.era).label}` : ''}
          </Text>
          {spinning && reel ? (
            <SpinReel
              items={reel.eras}
              itemHeight={layout.roomy ? 38 : 30}
              spinning={spinning}
              textStyle={StyleSheet.flatten([styles.eraName, layout.roomy && styles.eraNameRoomy])}
              onSettled={() => {
                setSpinning(false);
                setReel(null);
              }}
            />
          ) : (
            <Text
              style={[styles.eraName, layout.roomy && styles.eraNameRoomy]}
              numberOfLines={2}
              adjustsFontSizeToFit
            >
              {shown ? eraDef(shown.era).name : '—'}
            </Text>
          )}
          <Text style={styles.spinSub} numberOfLines={2}>
            {spinning ? '' : shown ? eraDef(shown.era).tagline : 'Awaiting spin'}
          </Text>
        </View>
      </View>

      {complete ? (
        <Pressable
          onPress={reveal}
          accessibilityRole="button"
          accessibilityLabel="Reveal your result"
          style={({ pressed, hovered }: PressState) => [
            styles.revealButton,
            hovered && styles.lift,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.revealLabel}>Reveal Result</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={(event) => doSpin(event?.nativeEvent as { shiftKey?: boolean } | undefined)}
          disabled={spinning || canPick}
          accessibilityRole="button"
          accessibilityLabel={canPick ? 'Make a pick before spinning again' : 'Spin the wheel'}
          style={({ pressed, hovered }: PressState) => [
            styles.spinButton,
            hovered && !canPick && styles.lift,
            pressed && { opacity: 0.85 },
            (spinning || canPick) && styles.spinButtonMuted,
          ]}
        >
          {spinning ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.spinButtonLabel, canPick && { color: color.textFaint }]}>
              {canPick
                ? 'Take a player first'
                : assistArmed
                  ? 'Rigged Spin'
                  : spin
                    ? `Spin · ${remaining} left`
                    : 'Spin The Wheel'}
            </Text>
          )}
        </Pressable>
      )}

      {assistArmed && !canPick && !complete ? (
        <Text style={styles.assistHint}>Three fingers down — this spin will find the best card left.</Text>
      ) : null}

      {game.assisted ? (
        <View style={styles.assistedFlag}>
          <Text style={styles.assistedFlagText}>
            Assisted run · this season won't count toward records
          </Text>
        </View>
      ) : null}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {lastPick ? (
        <View style={styles.lastPick}>
          <Text style={[styles.lastPickSlot, { color: positionColor[lastPick.card.position] }]}>
            {lastPick.slot}
          </Text>
          <Text style={styles.lastPickName} numberOfLines={1}>
            {displayName(lastPick.card)} '{String(lastPick.card.year).slice(2)}
          </Text>
          <Text style={styles.lastPickLocked}>Locked in</Text>
        </View>
      ) : null}

      <Field
        cards={filled}
        franchiseAbbrs={abbrs}
        highlight={targetSlots}
        target={targetSlot}
        blind={blind}
        onSlotPress={canPick ? pressSlot : undefined}
      />

      {canPick && !targetSlot ? (
        <Text style={styles.fieldHint}>Tap a position on the field to fill it</Text>
      ) : null}
    </View>
  );

  const browser = canPick ? (
    <View style={styles.browser}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="All" active={positionFilter === 'ALL'} onPress={() => setPositionFilter('ALL')} />
        {POSITIONS.map((position) => (
          <Chip
            key={position}
            label={position}
            tint={positionColor[position]}
            dimmed={!openPositions.has(position)}
            active={positionFilter === position}
            onPress={() => setPositionFilter(position)}
          />
        ))}
      </ScrollView>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search players or year"
        placeholderTextColor={color.textFaint}
        style={styles.search}
        accessibilityLabel="Search eligible players"
        autoCorrect={false}
      />

      <Text style={styles.count}>
        {targetSlot ? `Filling ${targetSlot} · ` : ''}
        {visible.length} eligible · one pick from this spin
      </Text>

      <View style={styles.list}>
        {visible.map((card) => {
          const slots = slotsForCard(card, game.selections);
          return (
            <PlayerRow
              key={card.id}
              card={card}
              name={displayName(card)}
              selected={selectedId === card.id}
              disabled={slots.length === 0}
              blind={blind}
              onPress={() => {
                if (targetSlot && slots.includes(targetSlot)) assign(card, targetSlot);
                else if (slots.length === 1) assign(card, slots[0]!);
                else setSelectedId(selectedId === card.id ? null : card.id);
              }}
              onDetails={() => router.push(`/card/${encodeURIComponent(card.id)}`)}
            />
          );
        })}
        {visible.length === 0 ? (
          <Text style={styles.empty}>Nothing here fits an open slot.</Text>
        ) : null}
      </View>
    </View>
  ) : (
    <View style={styles.waiting}>
      <Text style={styles.waitingTitle}>
        {complete ? 'Roster complete' : spin ? 'Slot filled' : 'Spin to begin'}
      </Text>
      <Text style={styles.waitingCopy}>
        {complete
          ? 'Seven picks are in. Reveal your season.'
          : `Each spin gives you exactly one pick. ${remaining} ${remaining === 1 ? 'slot' : 'slots'} to go.`}
      </Text>
    </View>
  );

  return (
    <Screen maxWidth={layout.maxWidth}>
      <View
        style={styles.touchLayer}
        pointerEvents="box-none"
        onTouchStart={(e) => trackTouches(e.nativeEvent.touches.length)}
        onTouchEnd={(e) => trackTouches(e.nativeEvent.touches.length)}
        onTouchCancel={() => trackTouches(0)}
      />
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Brand size={layout.wide ? 26 : 22} />
          {blind ? (
            <View style={styles.modeChip}>
              <Text style={styles.modeChipText}>Player IQ</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.headerRight}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${(game.selections.length / ROSTER_SLOTS.length) * 100}%` },
              ]}
            />
          </View>
          <Text style={styles.progress}>
            {game.selections.length}
            <Text style={styles.progressTotal}>/{ROSTER_SLOTS.length}</Text>
          </Text>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close game">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
      </View>

      {layout.wide ? (
        <View style={styles.columns}>
          <ScrollView style={styles.leftColumn} contentContainerStyle={styles.columnContent} showsVerticalScrollIndicator={false}>
            {spinPanel}
          </ScrollView>
          <ScrollView
            style={styles.rightColumn}
            contentContainerStyle={styles.columnContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {browser}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {spinPanel}
          {browser}
        </ScrollView>
      )}

      {selected && targetSlots.length > 1 ? (
        <View style={[styles.actionBar, { maxWidth: layout.wide ? 520 : undefined }]}>
          <Text style={styles.actionName} numberOfLines={1}>
            {displayName(selected)}
          </Text>
          <View style={styles.actionSlots}>
            {targetSlots.map((slotKey) => (
              <Pressable
                key={slotKey}
                onPress={() => assign(selected, slotKey)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${displayName(selected)} to ${slotKey}`}
                style={({ pressed, hovered }: PressState) => [
                  styles.actionSlot,
                  hovered && styles.lift,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={styles.actionSlotLabel}>{slotKey}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function Chip({
  label,
  active,
  tint,
  dimmed,
  onPress,
}: {
  label: string;
  active: boolean;
  tint?: string;
  dimmed?: boolean;
  onPress: () => void;
}) {
  const accent = tint ?? color.red;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ hovered }: PressState) => [
        styles.chip,
        hovered && { borderColor: accent },
        active && { backgroundColor: `${accent}26`, borderColor: accent },
        dimmed && !active && { opacity: 0.4 },
      ]}
    >
      <Text style={[styles.chipLabel, active && { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  modeChip: {
    borderWidth: 1,
    borderColor: '#B47CFF66',
    backgroundColor: '#B47CFF1A',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  modeChipText: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: '#C9A6FF',
    textTransform: 'uppercase',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  progressTrack: { width: 96, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF12', overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: color.red },
  progress: { fontFamily: font.display, fontSize: 20, color: color.text, includeFontPadding: false },
  progressTotal: { color: color.textFaint, fontSize: 14 },
  close: { fontFamily: font.body, fontSize: 18, color: color.textDim },

  scroll: { paddingHorizontal: space.lg, paddingBottom: 140, gap: space.md },
  columns: { flex: 1, flexDirection: 'row', gap: space.lg, paddingHorizontal: space.lg },
  leftColumn: { flex: 1.05 },
  rightColumn: { flex: 1 },
  columnContent: { paddingBottom: 120, gap: space.md },
  stack: { gap: space.md },

  spinRow: { flexDirection: 'row', gap: space.sm },
  spinCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    backgroundColor: '#0A0E13CC',
  },
  spinCardRoomy: { paddingVertical: space.lg },
  teamCard: { borderColor: '#E01A2B59' },
  eraCard: { borderColor: '#B47CFF4D' },
  spinLabel: { fontFamily: font.label, fontSize: 9, letterSpacing: tracking.wider, textTransform: 'uppercase' },
  spinValue: {
    fontFamily: font.displayBlack,
    fontSize: 34,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
    marginTop: 1,
  },
  spinValueRoomy: { fontSize: 44 },
  spinSub: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, lineHeight: 15 },
  eraName: {
    fontFamily: font.display,
    fontSize: 23,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
    marginTop: 1,
  },
  eraNameRoomy: { fontSize: 30 },
  fieldHint: {
    fontFamily: font.bodyRegular,
    fontSize: 11,
    color: color.textFaint,
    textAlign: 'center',
  },

  spinButton: {
    backgroundColor: color.red,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    shadowColor: color.red,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
  },
  spinButtonMuted: {
    backgroundColor: '#FFFFFF08',
    borderWidth: 1,
    borderColor: color.line,
    shadowOpacity: 0,
  },
  spinButtonLabel: {
    fontFamily: font.display,
    fontSize: 18,
    letterSpacing: tracking.wide,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  revealButton: {
    backgroundColor: color.gold,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: color.gold,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 5 },
  },
  revealLabel: {
    fontFamily: font.display,
    fontSize: 18,
    letterSpacing: tracking.wide,
    color: '#1A1200',
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  lift: { transform: [{ translateY: -1 }] },
  notice: { fontFamily: font.body, fontSize: 12, color: color.negative, textAlign: 'center' },
  touchLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  assistHint: {
    fontFamily: font.body,
    fontSize: 12,
    color: color.gold,
    textAlign: 'center',
  },
  assistedFlag: {
    borderWidth: 1,
    borderColor: '#F2C43D40',
    backgroundColor: '#F2C43D0D',
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: space.md,
  },
  assistedFlagText: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: color.gold,
    textTransform: 'uppercase',
    textAlign: 'center',
  },

  lastPick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: space.md,
    backgroundColor: '#FFFFFF05',
  },
  lastPickSlot: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, width: 34 },
  lastPickName: { flex: 1, fontFamily: font.heading, fontSize: 14, color: color.text },
  lastPickLocked: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: color.positive,
    textTransform: 'uppercase',
  },

  browser: { gap: space.sm },
  chips: { gap: space.xs, paddingRight: space.lg },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
  },
  chipLabel: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide, color: color.textDim },
  search: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    color: color.text,
    fontFamily: font.body,
    fontSize: 14,
    backgroundColor: '#FFFFFF05',
  },
  count: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  list: { gap: 5 },
  empty: {
    fontFamily: font.bodyRegular,
    fontSize: 13,
    color: color.textFaint,
    textAlign: 'center',
    paddingVertical: space.xl,
  },
  waiting: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.line,
    borderRadius: radius.md,
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    gap: 4,
  },
  waitingTitle: { fontFamily: font.heading, fontSize: 18, color: color.textDim },
  waitingCopy: {
    fontFamily: font.bodyRegular,
    fontSize: 13,
    color: color.textFaint,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 19,
  },

  actionBar: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.xl,
    alignSelf: 'center',
    backgroundColor: '#0D1219F5',
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  actionName: { flex: 1, fontFamily: font.heading, fontSize: 15, color: color.text },
  actionSlots: { flexDirection: 'row', gap: space.sm },
  actionSlot: { backgroundColor: color.red, borderRadius: radius.sm, paddingHorizontal: space.lg, paddingVertical: 9 },
  actionSlotLabel: { fontFamily: font.label, fontSize: 13, letterSpacing: tracking.wide, color: '#FFFFFF' },
});
