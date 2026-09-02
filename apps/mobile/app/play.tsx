import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { POSITIONS, ROSTER_SLOTS, SLOT_POSITION, type Position, type RosterSlot } from '@18-0/domain';
import { DATASET, displayName, eligibleCards, era as eraDef, franchise, type BootCard } from '@18-0/data';
import { Brand } from '@/components/Brand';
import { Field } from '@/components/Field';
import { SpinReel } from '@/components/SpinReel';
import { PlayerCard } from '@/components/PlayerCard';
import { Screen } from '@/components/Screen';
import { lookupCard, slotsForCard, useGameStore } from '@/state/game';
import { useHistoryStore } from '@/state/history';
import { ratingBucket, track } from '@/features/telemetry';
import { DECORATIVE, color, elevate, font, positionColor, radius, space, tabular, tracking, useLayout, type PressState } from '@/theme';

/** How many names blur past before the reel settles on the result. */
const REEL_LENGTH = 18;
const REEL_DURATION = 1150;

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
  const [lastPick, setLastPick] = useState<{ card: BootCard; slot: RosterSlot } | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [assistArmed, setAssistArmed] = useState(false);
  const [targetSlot, setTargetSlot] = useState<RosterSlot | null>(null);
  /** Live touch count, for the three-finger spin. */
  const fingers = useRef(0);
  const reelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  /** Drives the hero's collapse into the header. Native-driven, so it tracks the finger. */
  const scrollY = useRef(new Animated.Value(0)).current;
  const [heroHeight, setHeroHeight] = useState(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    // Sampling once meant a user who turned Reduce Motion on while the app was
    // backgrounded still got the reel when they came back.
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      subscription?.remove();
      if (reelTimer.current) clearTimeout(reelTimer.current);
    };
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
  // Also gated on `!spinning`: the spin resolves before the reel finishes, and
  // mounting thirty player rows inside the animation window is exactly the
  // UI-thread work Reanimated cannot protect the frame rate from.
  const canPick = game.status === 'spun' && !complete && !spinning;
  /** Player IQ mode: no ratings, no stats, no detail screen to peek at. */
  const blind = game.mode === 'player_iq';

  const filled = useMemo(
    () =>
      Object.fromEntries(game.selections.map((s) => [s.slot, lookupCard(s.cardId)])) as Partial<
        Record<RosterSlot, BootCard>
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
    const matched = eligible.filter((card) => {
      if (positionFilter !== 'ALL' && card.position !== positionFilter) return false;
      if (!needle) return true;
      return displayName(card).toLowerCase().includes(needle) || String(card.year).includes(needle);
    });
    if (!blind) return matched;
    // A rating-sorted list tells you the ratings even when they are hidden, so
    // Player IQ orders by position then name — no ranking information at all.
    return [...matched].sort(
      (a, b) =>
        a.position.localeCompare(b.position) ||
        displayName(a).localeCompare(displayName(b)) ||
        a.year - b.year,
    );
  }, [eligible, positionFilter, query, blind]);

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
        track('spin_dead_end', { filled: game.selections.length });
        return null;
      }
      track('spin_completed', {
        sequence: result.sequence,
        franchise: result.franchiseId,
        era: result.era,
        rigged: assist,
        filled: game.selections.length,
      });
      if (assist) track('spin_rigged', { sequence: result.sequence });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      AccessibilityInfo.announceForAccessibility(
        `${franchise(result.franchiseId).name}, ${eraDef(result.era).name}. Choose a player.`,
      );
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
      eras: [...decoys.map((c) => eraDef(c.era).label), eraDef(result.era).label],
    });
    setSpinning(true);
    if (reelTimer.current) clearTimeout(reelTimer.current);
    reelTimer.current = setTimeout(() => {
      setSpinning(false);
      setReel(null);
    }, REEL_DURATION + 120);
  }, [complete, game, reduceMotion, spinning]);

  const assign = useCallback(
    (card: BootCard, slot: RosterSlot) => {
      const outcome = game.select(card, slot);
      if (!outcome.ok) {
        track('selection_rejected', { slot, reason: outcome.message });
        setNotice(outcome.message);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        AccessibilityInfo.announceForAccessibility(outcome.message);
        return;
      }
      track('player_selected', {
        slot,
        position: card.position,
        rating: ratingBucket(card.rating),
        era: card.era,
        franchise: card.franchiseId,
        blind,
      });
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

      // If a player is already chosen and this slot can take them, this tap IS
      // the decision — assign. Previously it cleared the selection instead, so
      // tapping RB1 while the RB1/RB2 chooser was open dismissed the chooser
      // and made you pick the player all over again.
      const pending = selectedId ? eligible.find((c) => c.id === selectedId) : null;
      if (pending && slotsForCard(pending, game.selections).includes(slot)) {
        assign(pending, slot);
        return;
      }

      const next = targetSlot === slot ? null : slot;
      setTargetSlot(next);
      setPositionFilter(next ? SLOT_POSITION[slot] : 'ALL');
      setSelectedId(null);
      if (next) track('slot_targeted', { slot: next });
      Haptics.selectionAsync().catch(() => {});
    },
    [assign, canPick, eligible, filled, game.selections, selectedId, targetSlot],
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
    track('roster_completed', {
      rating: ratingBucket(result.finalRating),
      record: `${result.record.wins}-${result.record.losses}`,
      ending: result.ending.key,
      mode: game.mode,
      assisted: game.assisted,
      spins: game.spins.length,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.replace('/result');
  }, [game, record, router]);

  const shown = spin && canPick ? { franchiseId: spin.franchiseId, era: spin.era } : null;
  const team = shown ? franchise(shown.franchiseId) : null;
  const remaining = ROSTER_SLOTS.length - game.selections.length;

  // What you spun is the thing you are reasoning about for the whole pick, so
  // it does not simply scroll away: the hero hands off to a compact line beside
  // the step counter, and hands back on the way up. The two cross-fade over the
  // second half of the hero's own height, which makes the swap read as one
  // object moving rather than two things blinking.
  const collapseFrom = Math.max(24, heroHeight * 0.35);
  const collapseTo = Math.max(collapseFrom + 1, heroHeight * 0.85);
  const collapseRange = { inputRange: [collapseFrom, collapseTo], extrapolate: 'clamp' as const };
  const collapsible = team !== null && heroHeight > 0;
  const pillOpacity = collapsible ? scrollY.interpolate({ ...collapseRange, outputRange: [0, 1] }) : 0;
  const pillShift = collapsible ? scrollY.interpolate({ ...collapseRange, outputRange: [12, 0] }) : 0;
  const trackOpacity = collapsible ? scrollY.interpolate({ ...collapseRange, outputRange: [1, 0] }) : 1;
  // The hero eases out as it goes rather than being cut off by the sticky bar.
  const heroOpacity = collapsible ? scrollY.interpolate({ ...collapseRange, outputRange: [1, 0.15] }) : 1;

  // --- pieces, composed differently per breakpoint -------------------------

  const spinPanel = (
    <View style={styles.stack}>
      {/* One full-width hero rather than two cramped columns. What a spin gave
          you is the single most important thing on this screen, and at 34pt in
          a half-width box it was reading as a caption. */}
      <Animated.View
        onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)}
        style={[styles.hero, team ? { borderColor: `${team.color}73` } : null, { opacity: heroOpacity }]}
      >
        {team ? (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <LinearGradient id="heroWash" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={team.color} stopOpacity="0.34" />
                <Stop offset="0.55" stopColor={team.color2 || team.color} stopOpacity="0.09" />
                <Stop offset="1" stopColor={team.color} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroWash)" />
          </Svg>
        ) : null}

        <View style={styles.heroTop}>
          <View style={[styles.heroTeam, layout.roomy && styles.heroTeamRoomy]}>
            <Text style={[styles.spinLabel, { color: color.red }]}>Team</Text>
            {spinning && reel ? (
              <SpinReel
                items={reel.teams}
                itemHeight={layout.roomy ? 86 : 66}
                spinning={spinning}
                textStyle={StyleSheet.flatten([styles.heroAbbr, layout.roomy && styles.heroAbbrRoomy])}
              />
            ) : (
              <Text
                style={[
                  styles.heroAbbr,
                  layout.roomy && styles.heroAbbrRoomy,
                  !team && styles.heroWaiting,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {/* An em dash set at 62pt is a white bar, not a placeholder. */}
                {team ? team.abbr : 'Ready'}
              </Text>
            )}
            <Text style={styles.heroNick} numberOfLines={1}>
              {spinning ? 'Spinning…' : team ? team.nick : 'Awaiting spin'}
            </Text>
          </View>

          <View style={styles.heroDivider} />

          <View style={styles.heroEra}>
            <Text style={[styles.spinLabel, { color: '#C49BFF' }]}>Era</Text>
            {/* Years first. The era names are good flavour and useless at speed
                -- you pick against a decade you can picture, not against a
                phrase you have to decode mid-spin. */}
            {spinning && reel ? (
              <SpinReel
                items={reel.eras}
                itemHeight={layout.roomy ? 48 : 42}
                spinning={spinning}
                textStyle={StyleSheet.flatten([styles.heroEraYears, layout.roomy && styles.heroEraYearsRoomy])}
              />
            ) : (
              <Text
                style={[
                  styles.heroEraYears,
                  layout.roomy && styles.heroEraYearsRoomy,
                  !shown && styles.heroWaiting,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {shown ? eraDef(shown.era).label : 'Any year'}
              </Text>
            )}
            <Text style={styles.heroEraName} numberOfLines={1}>
              {spinning ? '' : shown ? eraDef(shown.era).name : ''}
            </Text>
          </View>
        </View>

        {/* The tagline is the flavour that makes an era mean something, so it
            gets the full width instead of being cut off mid-word. */}
        <Text style={styles.heroTagline} numberOfLines={3}>
          {spinning ? '' : shown ? eraDef(shown.era).tagline : 'Spin for a franchise and an era.'}
        </Text>
      </Animated.View>

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

      {notice ? (
        <Text style={styles.notice} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}

      {lastPick ? (
        <View style={styles.lastPick} accessibilityLiveRegion="polite">
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

      {canPick ? (
        <Text style={styles.fieldHint}>
          {selected && targetSlots.length > 1
            ? `Tap ${targetSlots.join(' or ')} on the field to place ${displayName(selected)}`
            : targetSlot
              ? `Filling ${targetSlot} — choose a player`
              : 'Tap a position on the field, or pick a player'}
        </Text>
      ) : null}
    </View>
  );

  /**
   * Position filters and search, pinned to the top of the list.
   *
   * The field graphic and the filter chips both scroll away as soon as you are
   * a few players down the list, which left no way to change position or find a
   * name without scrolling all the way back up. This bar sticks, and carries a
   * shortcut back to the lineup with it.
   */
  const pickBar = canPick ? (
    <View style={styles.pickBar}>
      <View style={styles.pickBarRow}>
        {targetSlot ? (
          <Pressable
            onPress={() => setTargetSlot(null)}
            accessibilityRole="button"
            accessibilityLabel={`Filling ${targetSlot}. Tap to clear.`}
            style={styles.fillingPill}
          >
            <Text style={[styles.fillingText, { color: positionColor[SLOT_POSITION[targetSlot]] }]}>
              {targetSlot} ✕
            </Text>
          </Pressable>
        ) : null}
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
        <Pressable
          onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
          accessibilityRole="button"
          accessibilityLabel="Back to the lineup"
          style={({ pressed, hovered }: PressState) => [
            styles.lineupButton,
            hovered && styles.lift,
            pressed && { opacity: 0.8 },
          ]}
        >
          <Text style={styles.lineupButtonText}>↑ Lineup</Text>
        </Pressable>
      </View>

      <View style={styles.pickBarRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search players or year"
          placeholderTextColor={color.textFaint}
          style={[styles.search, styles.searchInBar]}
          accessibilityLabel="Search eligible players"
          autoCorrect={false}
        />
        <View style={styles.countPill}>
          <Text style={styles.countPillValue}>{visible.length}</Text>
        </View>
      </View>
    </View>
  ) : (
    <View />
  );

  const browser = canPick ? (
    <View style={styles.browser}>
      <Text style={styles.count}>
        {targetSlot ? `Filling ${targetSlot} · ` : ''}
        {visible.length} eligible · one pick from this spin
      </Text>

      <View style={styles.list}>
        {visible.map((card, index) => {
          const slots = slotsForCard(card, game.selections);
          return (
            <PlayerCard
              key={card.id}
              card={card}
              index={index}
              name={displayName(card)}
              selected={selectedId === card.id}
              disabled={slots.length === 0}
              blind={blind}
              onPress={() => {
                if (targetSlot && slots.includes(targetSlot)) assign(card, targetSlot);
                else if (slots.length === 1) assign(card, slots[0]!);
                else setSelectedId(selectedId === card.id ? null : card.id);
              }}
              onDetails={() => {
                track('player_details_opened', { position: card.position });
                router.push(`/card/${encodeURIComponent(card.id)}`);
              }}
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
        {complete ? 'Roster complete' : spinning ? 'Spinning…' : spin ? 'Slot filled' : 'Spin to begin'}
      </Text>
      <Text style={styles.waitingCopy}>
        {complete
          ? 'Seven picks are in. Reveal your season.'
          : spinning
            ? 'Finding you a franchise and an era.'
            : `Each spin gives you exactly one pick. ${remaining} ${remaining === 1 ? 'slot' : 'slots'} to go.`}
      </Text>
    </View>
  );

  return (
    <Screen maxWidth={layout.wide ? 780 : undefined}>
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
          <View style={styles.headerSwap}>
            <Animated.View
              style={[styles.headerSwapLayer, { opacity: trackOpacity }]}
              pointerEvents="none"
              {...DECORATIVE}
            >
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${(game.selections.length / ROSTER_SLOTS.length) * 100}%` },
                  ]}
                />
              </View>
            </Animated.View>
            <Animated.View
              style={[
                styles.headerSwapLayer,
                styles.headerSpinLine,
                { opacity: pillOpacity, transform: [{ translateY: pillShift }] },
              ]}
              pointerEvents="none"
              {...DECORATIVE}
            >
              <View style={styles.headerMetaPair}>
                <Text style={styles.headerMetaLabel}>Team</Text>
                <Text style={styles.headerAbbr} numberOfLines={1}>
                  {team ? team.abbr : '—'}
                </Text>
              </View>
              <View style={styles.headerMetaPair}>
                <Text style={styles.headerMetaLabel}>Era</Text>
                <Text style={styles.headerEra} numberOfLines={1}>
                  {shown ? eraDef(shown.era).label : '—'}
                </Text>
              </View>
            </Animated.View>
          </View>
          <Text style={styles.progress}>
            {game.selections.length}
            <Text style={styles.progressTotal}>/{ROSTER_SLOTS.length}</Text>
          </Text>
          <Pressable onPress={() => router.back()} hitSlop={14} accessibilityRole="button" accessibilityLabel="Close game">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={canPick ? [1] : undefined}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
      >
        {spinPanel}
        {pickBar}
        {browser}
      </Animated.ScrollView>

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
      accessibilityLabel={`Filter by ${label}${dimmed ? ', no open slot' : ''}`}
      accessibilityState={{ selected: active, disabled: dimmed === true }}
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
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
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
  headerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.md },
  /** Holds the progress track and the collapsed spin line in the same box.
      Flexes rather than sitting at a fixed width: with labels the spin line is
      much wider than the bare abbreviation was, and a fixed box clipped it. */
  headerSwap: { flex: 1, minWidth: 0, height: 28, justifyContent: 'center' },
  headerSwapLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' },
  /** Pairs are grouped by spacing: 5pt binds a label to its value, 14pt separates
      the two pairs. Without that contrast the line reads as four evenly-spaced
      words rather than two facts. */
  headerSpinLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'flex-end', gap: 14 },
  headerMetaPair: { flexDirection: 'row', alignItems: 'baseline', gap: 5, flexShrink: 1, minWidth: 0 },
  headerMetaLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textFaint,
    includeFontPadding: false,
  },
  headerAbbr: {
    fontFamily: font.displayBlack,
    fontSize: 17,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  headerEra: {
    fontFamily: font.bodyBold,
    fontSize: 12,
    letterSpacing: tracking.wide,
    color: color.textDim,
    flexShrink: 1,
    ...tabular,
  },
  progressTrack: { width: 96, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF12', overflow: 'hidden', alignSelf: 'flex-end' },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: color.red },
  progress: { fontFamily: font.display, fontSize: 20, color: color.text, includeFontPadding: false, ...tabular },
  progressTotal: { color: color.textFaint, fontSize: 14 },
  close: {
    fontFamily: font.body,
    fontSize: 18,
    color: color.textDim,
    // No minWidth/minHeight here: those reserved 44pt of *visual* width and
    // tore a hole between the score and the ✕. The Pressable's hitSlop already
    // provides the touch target.
    includeFontPadding: false,
    lineHeight: 44,
    textAlign: 'center',
  },

  scroll: { paddingHorizontal: space.lg, paddingBottom: 140, gap: space.md },
  columns: { flex: 1, flexDirection: 'row', gap: space.lg, paddingHorizontal: space.lg, overflow: 'hidden' },
  leftColumn: { width: '52%', minWidth: 0 },
  rightColumn: { width: '45%', minWidth: 0 },
  columnContent: { paddingBottom: 120, gap: space.md },
  stack: { gap: space.md },

  hero: {
    borderWidth: 1,
    borderColor: '#D50A0A59',
    borderRadius: radius.lg,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
    backgroundColor: '#0A0E13E6',
    overflow: 'hidden',
    gap: space.sm,
  },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  heroTeam: { width: 122 },
  heroTeamRoomy: { width: 168 },
  heroDivider: { alignSelf: 'stretch', width: 1, backgroundColor: color.line, marginVertical: 2 },
  heroEra: { flex: 1, minWidth: 0, gap: 2 },
  spinLabel: { fontFamily: font.label, fontSize: 10, letterSpacing: tracking.wider, textTransform: 'uppercase' },
  heroAbbr: {
    fontFamily: font.displayBlack,
    fontSize: 62,
    lineHeight: 66,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  heroAbbrRoomy: { fontSize: 82, lineHeight: 86 },
  heroNick: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim },
  /** The pre-spin state: same slot, quieter and smaller, so nothing shouts a blank. */
  heroWaiting: { fontSize: 30, lineHeight: 36, color: color.textFaint, letterSpacing: tracking.tight },
  heroEraYears: {
    fontFamily: font.displayBlack,
    fontSize: 38,
    lineHeight: 42,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
    ...tabular,
  },
  heroEraYearsRoomy: { fontSize: 46, lineHeight: 50 },
  heroEraName: {
    fontFamily: font.label,
    fontSize: 13,
    letterSpacing: tracking.wide,
    color: '#C49BFF',
    textTransform: 'uppercase',
  },
  heroTagline: { fontFamily: font.bodyRegular, fontSize: 13, lineHeight: 19, color: color.textFaint },

  pickBar: {
    backgroundColor: color.void,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    gap: space.sm,
  },
  pickBarRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fillingPill: {
    borderWidth: 1,
    borderColor: color.lineBright,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    height: 34,
    justifyContent: 'center',
  },
  fillingText: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide },
  lineupButton: {
    borderWidth: 1,
    borderColor: color.lineBright,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    height: 34,
    justifyContent: 'center',
  },
  lineupButtonText: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, color: color.textDim },
  searchInBar: { flex: 1, marginBottom: 0 },
  countPill: {
    minWidth: 46,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillValue: { fontFamily: font.display, fontSize: 19, color: color.text, ...tabular },
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
    ...elevate(6),
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
  // Deliberately red, not gold: gold is reserved for an earned 18-0, and this
  // button fires on every game including the ones that end 2-16.
  revealButton: {
    backgroundColor: color.red,
    borderRadius: radius.md,
    paddingVertical: 15,
    minHeight: 50,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: color.red,
    shadowOpacity: 0.5,
    ...elevate(6),
  },
  revealLabel: {
    fontFamily: font.display,
    fontSize: 18,
    letterSpacing: tracking.wide,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  lift: { transform: [{ translateY: -1 }] },
  notice: { fontFamily: font.body, fontSize: 12, color: color.negative, textAlign: 'center' },
  touchLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  assistHint: {
    fontFamily: font.body,
    fontSize: 12,
    color: color.ice,
    textAlign: 'center',
  },
  assistedFlag: {
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF08',
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: space.md,
  },
  assistedFlagText: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: color.textDim,
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
    minHeight: 44,
    justifyContent: 'center',
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
    ...elevate(10),
  },
  actionName: { flex: 1, fontFamily: font.heading, fontSize: 15, color: color.text },
  actionSlots: { flexDirection: 'row', gap: space.sm },
  actionSlot: {
    backgroundColor: color.red,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  actionSlotLabel: { fontFamily: font.label, fontSize: 13, letterSpacing: tracking.wide, color: '#FFFFFF' },
});
