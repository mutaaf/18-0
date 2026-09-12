import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ROSTER_SLOTS, isPerfectionDenied, type RosterSlot } from '@18-0/domain';
import { displayName, eraLabel, franchise } from '@18-0/data';
import { Brand } from '@/components/Brand';
import { EASE_OUT, Layer, SkipLayer, keyframes, useTimeline } from '@/components/Broadcast';
import { CUE, ROSTER_STEP, Scoreboard } from '@/components/Scoreboard';
import { Celebration } from '@/components/Celebration';
import { Screen } from '@/components/Screen';
import { RatingBadge } from '@/components/RatingBadge';
import { ShareCard, type ShareRosterRow } from '@/components/ShareCard';
import { homeRoute, isEmbedded, tellHost } from '@/features/embed';
import { standing } from '@/features/frame-standing';
import { shareResult } from '@/features/share';
import { askForReminders, scheduleStreakReminder } from '@/features/reminders';
import { currentUser, hideSeason } from '@/services/supabase';
import { lookupCard, useGameStore } from '@/state/game';
import { useHistoryStore } from '@/state/history';
import {
  DECORATIVE,
  color,
  elevate,
  font,
  positionColor,
  radius,
  space,
  tabular,
  themed,
  tierColor,
  tracking,
  type PressState,
  useLayout,
  useThemeId,
} from '@/theme';

/**
 * The reveal does two jobs: land the result hard, and make the next spin feel
 * inevitable. So the distance from 18-0 is the second thing on the page rather
 * than a footnote — the whole product is the chase.
 *
 * The landing is a broadcast build rather than a page that fades in, and the
 * whole page is on one clock to make it one: the rundown is `CUE` in
 * `Scoreboard.tsx`, and everything here — the chase meter, the badges, the
 * buttons, every roster row — is a `Layer` reading its window off `line.t`.
 *
 * Three things that were separately true and had to be made simultaneously
 * true, because each of them is a way to lose the result behind the animation:
 *
 * - **Reduce Motion gets no sequence at all.** Not a slower one. `useTimeline`
 *   settles before the first paint and every layer is at its end state.
 * - **A tap on the panel ends it.** `line.settle()` puts the clock at its last
 *   millisecond, which is the same state the sequence would have reached, so
 *   there is no separate "skipped" rendering to get wrong.
 * - **Nothing is conditional on a cue.** Every value on this page is in the
 *   tree from the first frame and only its opacity moves, so a driver that
 *   never runs costs a fade, not a score.
 */
const PERFECT_THRESHOLD = 98.5;

export default function Result() {
  // Subscribes this screen to the palette. React Navigation memoizes the
  // element it was handed, so a theme change reaches the component that
  // *creates* this screen's children or it reaches nothing -- which showed up
  // as a repainted picker sitting inside a screen still wearing the old
  // colours. `theme.test.ts` asserts every route does this.
  useThemeId();
  // The host frame sizes itself to the screen: a seven-row roster and the
  // analysis panels are several times the height of the entry card.
  useEffect(() => tellHost('result'), []);
  const router = useRouter();
  const layout = useLayout();
  const game = useGameStore();
  const history = useHistoryStore((s) => s.games);
  const result = game.result;

  const cardRef = useRef<View>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  /** Optimistic: the row flips immediately and reverts if the server refuses. */
  const [boardHidden, setBoardHidden] = useState(false);

  /**
   * Whether this account has a linked identity, which is the only thing between
   * a scored season and the public board (0011: every board filters on
   * `profiles.is_permanent`).
   *
   * Asked only in a frame, because only a frame has to answer the question in
   * copy: the full app has an account screen, a sign-in button and a board tab
   * to say it for it. Starts `null` and stays null until the answer arrives --
   * see `frame-standing.ts` for why a guess in either direction is the bug.
   */
  const [permanent, setPermanent] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isEmbedded()) return;
    let live = true;
    void currentUser()
      .then((me) => live && setPermanent(me ? !me.anonymous : false))
      // No session at all is the same answer as an anonymous one: not on the
      // board. It is only "unknown" while the question is still in flight.
      .catch(() => live && setPermanent(false));
    return () => {
      live = false;
    };
  }, []);

  // Asked here rather than at launch: a prompt before the first season asks
  // somebody to protect a streak they do not have. A ranked season that just
  // scored is the first moment there is something to lose.
  useEffect(() => {
    if (!game.serverSessionId || game.assisted) return;
    void askForReminders().then((granted) => {
      if (granted) void scheduleStreakReminder();
    });
  }, [game.serverSessionId, game.assisted]);

  // One clock for the whole page. Read before the early return below, so the
  // hook order never changes.
  const line = useTimeline(CUE.end, result?.finalRating);

  /**
   * The celebration is not its own event.
   *
   * Mounted with the screen it threw confetti over a panel that had not
   * finished building and a record that still said 0-0 -- two moments a second
   * apart, neither of which was the moment. It belongs to the frame the tier
   * stamps on, and to that frame only.
   */
  const [onAir, setOnAir] = useState(false);
  useEffect(() => {
    if (line.settled) {
      setOnAir(true);
      return;
    }
    const at = setTimeout(() => setOnAir(true), CUE.stamp);
    return () => clearTimeout(at);
  }, [line.settled]);

  const rosterCards = useMemo(
    () =>
      game.selections
        .map((s) => ({ slot: s.slot, card: lookupCard(s.cardId) }))
        .filter(
          (x): x is { slot: RosterSlot; card: NonNullable<ReturnType<typeof lookupCard>> } => !!x.card,
        )
        .sort((a, b) => ROSTER_SLOTS.indexOf(a.slot) - ROSTER_SLOTS.indexOf(b.slot)),
    [game.selections],
  );

  const shareRows: ShareRosterRow[] = useMemo(
    () =>
      rosterCards.map(({ slot, card }) => ({
        slot,
        name: displayName(card),
        abbr: franchise(card.franchiseId).abbr,
        year: card.year,
        rating: card.rating,
        position: card.position,
      })),
    [rosterCards],
  );

  /** The best honest run before this one, so the result can say if it was beaten. */
  const previousBest = useMemo(() => {
    const ratings = history
      .filter((g) => !g.assisted)
      .map((g) => g.result.finalRating)
      .sort((a, b) => b - a);
    return ratings.length > 1 ? ratings[1]! : null;
  }, [history]);

  /**
   * The buzz belongs to the frame the record locks on.
   *
   * Fired on mount it arrived a full second before the number it was reacting
   * to, which read as the phone going off at nothing. The rating it fired for
   * is remembered so a skip tap, the natural end of the sequence and the
   * failsafe cannot between them buzz the same result three times.
   */
  const buzzedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!result) return;
    const rating = result.finalRating;
    if (buzzedFor.current === rating) return;
    const fire = () => {
      if (buzzedFor.current === rating) return;
      buzzedFor.current = rating;
      const wins = result.record.wins;
      if (wins >= 12) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      else if (wins >= 9) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    };
    if (line.settled) {
      fire();
      return;
    }
    const at = setTimeout(fire, CUE.lock);
    return () => clearTimeout(at);
  }, [result?.finalRating, line.settled]);

  useEffect(() => {
    if (!result) router.replace(homeRoute());
  }, [result]);

  if (!result) {
    return (
      <Screen>
        <View style={styles.blank} />
      </Screen>
    );
  }

  /**
   * Where this season actually stands, for a frame that has to say so itself.
   *
   * Null everywhere else: the full app answers this with an account screen and
   * a leaderboard tab rather than a sentence. Null in a frame too until the
   * account has answered -- `standing()` refuses to claim anything it does not
   * know yet.
   */
  const frameLine = isEmbedded()
    ? standing({
        // The server session is the proof, not the `ranked` flag: `downgrade()`
        // clears the session and leaves nothing to rank.
        ranked: Boolean(game.serverSessionId),
        permanent,
        assisted: game.assisted,
      })
    : null;

  const perfect = result.ending.key === 'PERFECT';
  const denied = isPerfectionDenied(result);
  const heartbreak = result.ending.key === 'HEARTBREAK';
  const accent = perfect ? color.gold : tierColor[result.ending.tier] ?? color.text;
  const wins = result.record.wins;

  // The record grows with the achievement (PRFAQ §22.4).
  const recordSize = layout.wide
    ? wins >= 17
      ? 128
      : wins >= 14
        ? 112
        : wins >= 9
          ? 98
          : 82
    : wins >= 17
      ? 94
      : wins >= 14
        ? 84
        : wins >= 9
          ? 74
          : 62;

  const share = () => {
    void shareResult(cardRef, result, shareRows).then((mode) => {
      if (mode === 'text') setShareNote('Shared as text — the image could not be generated.');
    });
  };

  const buildAnother = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    game.startGame();
    router.replace('/play');
  };

  // Confetti over a 4-14 would read as mockery, so the celebration only starts
  // once the season is one worth celebrating, and grows from there.
  const celebration = perfect ? 1 : wins >= 17 ? 0.92 : wins >= 15 ? 0.7 : wins >= 12 ? 0.45 : wins >= 10 ? 0.25 : 0;

  const beatBest = previousBest !== null && result.finalRating > previousBest;
  const toPerfect = Math.max(0, PERFECT_THRESHOLD - result.finalRating);
  const progress = Math.min(1, result.finalRating / PERFECT_THRESHOLD);

  // ---------------------------------------------------------------- verdict

  const verdict = (
    <View style={styles.verdictColumn}>
      <View>
        <Scoreboard
          line={line}
          wins={wins}
          losses={result.record.losses}
          label={perfect ? 'PERFECT' : result.ending.label.toUpperCase()}
          tier={result.ending.tier}
          rating={result.finalRating}
          accent={accent}
          perfect={perfect}
          recordSize={recordSize}
          crownSize={layout.wide ? 64 : 50}
          summary={`Final result. ${wins} and ${result.record.losses}. ${result.ending.label}. Tier ${result.ending.tier}. Rating ${result.finalRating.toFixed(1)}.`}
        />
        {/* Over the panel and nothing else, and only while there is something
            to skip. The panel carries no controls, so a tap it swallows costs
            nobody anything; a layer over the page would have eaten the first
            press on Build Another. */}
        {line.settled ? null : <SkipLayer onPress={line.settle} />}
      </View>

      {/* The hook: how close you came, and what it would take to go again. */}
      <Layer t={line.t} at={CUE.meter - 140} style={styles.chase}>
        {perfect ? (
          <Text style={styles.chaseHeadline}>
            No weaknesses. No compromises. A roster for the ages.
          </Text>
        ) : (
          <>
            <View style={styles.chaseHead}>
              <Text style={styles.chaseLabel}>Distance from 18-0</Text>
              <Text style={styles.chaseValue}>{toPerfect.toFixed(2)}</Text>
            </View>
            <View style={styles.meter}>
              {/* scaleX rather than width: width cannot be driven natively, and
                  dropping this one bar off the driver stutters the whole
                  sequence on a mid-range phone. */}
              <Animated.View
                style={[
                  styles.meterFill,
                  {
                    transform: [
                      {
                        scaleX: keyframes(line.t, CUE.meter, 640, EASE_OUT).interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, progress],
                        }),
                      },
                    ],
                  },
                ]}
              />
            </View>
            <Text style={styles.chaseCopy}>
              {denied
                ? 'You cleared the score. A gate stopped you.'
                : heartbreak
                  ? 'One loss from immortality.'
                  : beatBest
                    ? `A new personal best — ${previousBest!.toFixed(1)} was the mark. Go again.`
                    : 'Seven better picks and the crown is yours.'}
            </Text>
          </>
        )}
      </Layer>

      {denied ? (
        <Layer t={line.t} at={CUE.tail - 60} style={styles.denied}>
          <Text style={styles.deniedTitle}>Perfection Denied</Text>
          {result.perfectEligibility.failedGates.slice(0, 3).map((gate) => (
            <Text key={`${gate.kind}-${gate.slot}`} style={styles.deniedGate}>
              {gate.message}
            </Text>
          ))}
        </Layer>
      ) : null}

      {game.mode === 'player_iq' || game.assisted ? (
        <Layer t={line.t} at={CUE.tail} style={styles.badgeRow}>
          {game.mode === 'player_iq' ? (
            <View style={[styles.badge, styles.badgeBlind]}>
              <Text style={styles.badgeBlindText}>Built blind · GM Mode</Text>
            </View>
          ) : null}
          {game.assisted ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Assisted · not counted</Text>
            </View>
          ) : null}
        </Layer>
      ) : null}

      {/* The one thing about a finished season that may still change.
          Hiding is offered; counting is not, and cannot be -- a season the
          server never dealt has nothing to verify, and one it did deal was
          already counted before the score was known. This only ever lowers
          you, which is exactly why it is safe to offer after the fact. */}
      {game.serverSessionId && !game.assisted ? (
        <Layer t={line.t} at={CUE.tail + 60}>
          <Pressable
            onPress={() => {
              const next = !boardHidden;
              setBoardHidden(next);
              void hideSeason(game.serverSessionId!, next).then((ok) => {
                if (!ok) setBoardHidden(!next);
              });
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: !boardHidden }}
            accessibilityLabel="Show this season on the leaderboard"
            style={({ hovered }: PressState) => [
              styles.boardRow,
              hovered && { borderColor: color.lineBright },
            ]}
          >
            <View style={styles.boardText}>
              <Text style={styles.boardTitle}>
                {boardHidden ? 'Kept off the board' : 'On the board'}
              </Text>
              <Text style={styles.boardCopy}>
                {boardHidden
                  ? 'Nobody else can see this season. It earns you no points.'
                  : 'Counts towards your level and can rank on the board.'}
              </Text>
            </View>
            <View style={[styles.boardToggle, boardHidden && styles.boardToggleOff]}>
              <Text style={[styles.boardToggleText, boardHidden && styles.boardToggleTextOff]}>
                {boardHidden ? 'SHOW' : 'HIDE'}
              </Text>
            </View>
          </Pressable>
        </Layer>
      ) : null}

      {/* A frame has no board tab, no account button and no way to find out
          where a season went except by being told. This is that telling, and
          `frame-standing.ts` records what it is allowed to say -- the whole
          reason the frame played this season unranked for so long is that
          somebody wrote a sentence about the board that nothing checked. */}
      {frameLine ? (
        <Layer t={line.t} at={CUE.tail + 90} style={styles.standing}>
          <Text style={styles.standingTitle}>{frameLine.title}</Text>
          <Text style={styles.standingCopy}>{frameLine.copy}</Text>
          {frameLine.offerBoard ? (
            <Pressable
              // `replace`, not `push`: the frame's back stack is invisible to
              // the player and the host's tabs are the only navigation there is.
              onPress={() => router.replace('/embed?view=board')}
              accessibilityRole="button"
              accessibilityLabel="See the Scout leaderboard"
              style={({ hovered, pressed }: PressState) => [
                styles.standingLink,
                hovered && { borderColor: color.gold },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.standingLinkLabel}>See the board</Text>
            </Pressable>
          ) : null}
        </Layer>
      ) : null}

      <Layer t={line.t} at={CUE.tail + 120} style={styles.actions}>
        <Pressable
          style={({ pressed, hovered }: PressState) => [
            styles.primary,
            hovered && styles.lift,
            pressed && { opacity: 0.88 },
          ]}
          onPress={buildAnother}
          accessibilityRole="button"
          accessibilityLabel="Build another roster"
        >
          <Text style={styles.primaryLabel}>Build Another</Text>
        </Pressable>
        <Pressable
          style={({ pressed, hovered }: PressState) => [
            styles.secondary,
            hovered && { borderColor: color.gold },
            pressed && { opacity: 0.85 },
          ]}
          onPress={share}
          accessibilityRole="button"
          accessibilityLabel="Share this result"
        >
          <Text style={styles.secondaryLabel}>Share</Text>
        </Pressable>
      </Layer>

      {shareNote ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {shareNote}
        </Text>
      ) : null}
    </View>
  );

  // ----------------------------------------------------------------- detail

  // The two analysis panels build after the last roster row rather than at a
  // time somebody wrote down once and never updated: the roster is seven rows
  // today and the slot list is not this file's to fix.
  const rosterEnd = CUE.roster + rosterCards.length * ROSTER_STEP;

  const detail = (
    <View style={styles.detailColumn}>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Roster</Text>
        {rosterCards.map(({ slot, card }, index) => (
          <Layer key={slot} t={line.t} at={CUE.roster + index * ROSTER_STEP}>
            {/* Every name in the app opens its card. A player who has just
                been told a roster scored 92.6 will want to look at the seven
                seasons that did it. */}
            <Pressable
              onPress={() => router.push(`/card/${encodeURIComponent(card.id)}`)}
              style={({ hovered, pressed }: PressState) => [
                styles.rosterRow,
                hovered && { backgroundColor: '#FFFFFF0A' },
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${slot}. ${displayName(card)}. ${card.year} ${franchise(card.franchiseId).name}. Rating ${card.rating.toFixed(1)}. Tap for the card.`}
            >
            <Text style={[styles.rosterSlot, { color: positionColor[card.position] }]}>{slot}</Text>
            <View style={styles.rosterMain}>
              <Text style={styles.rosterName} numberOfLines={1}>
                {displayName(card)}
              </Text>
              <Text style={styles.rosterMeta} numberOfLines={1}>
                {franchise(card.franchiseId).abbr} · {card.year} · {eraLabel(card.era)}
              </Text>
            </View>
            <RatingBadge rating={card.rating} size="sm" />
            </Pressable>
          </Layer>
        ))}
      </View>

      <Layer t={line.t} at={rosterEnd + 40} style={styles.panel}>
        <Text style={styles.panelTitle}>How it scored</Text>
        <Line label="Weighted roster rating" value={result.breakdown.baseRating.toFixed(2)} />
        <Line
          label="Weak-link penalty"
          value={
            result.breakdown.weakLinkPenalty > 0
              ? `−${result.breakdown.weakLinkPenalty.toFixed(2)}`
              : '0.00'
          }
          tone={result.breakdown.weakLinkPenalty > 0 ? color.negative : undefined}
        />
        <Line
          label="Elite depth bonus"
          value={`+${result.breakdown.eliteBonus.toFixed(2)}`}
          tone={result.breakdown.eliteBonus > 0 ? color.positive : undefined}
        />
        <Line
          label="Chemistry"
          value={`${result.breakdown.chemistryBonus >= 0 ? '+' : '−'}${Math.abs(result.breakdown.chemistryBonus).toFixed(2)}`}
          tone={
            result.breakdown.chemistryBonus === 0
              ? undefined
              : result.breakdown.chemistryBonus > 0
                ? color.positive
                : color.negative
          }
        />
        {result.breakdown.weakLinkDetail.length > 0 ? (
          <Text style={styles.footnote}>
            Biggest drag: {result.breakdown.weakLinkDetail[0]!.slot} at{' '}
            {result.breakdown.weakLinkDetail[0]!.rating.toFixed(1)}
          </Text>
        ) : null}
      </Layer>

      {result.breakdown.chemistryDetail.links.length > 0 ? (
        <Layer t={line.t} at={rosterEnd + 120} style={styles.panel}>
          <Text style={styles.panelTitle}>Chemistry</Text>
          {result.breakdown.chemistryDetail.links.map((link) => (
            <View key={link.key} style={styles.chemRow}>
              <Text style={styles.chemLabel} numberOfLines={1}>
                {link.label}
              </Text>
              <Text
                style={[
                  styles.chemValue,
                  { color: link.value >= 0 ? color.positive : color.negative },
                ]}
              >
                {link.value >= 0 ? '+' : '−'}
                {Math.abs(link.value).toFixed(2)}
              </Text>
            </View>
          ))}
        </Layer>
      ) : null}

      <Text style={styles.modelNote}>
        Scoring model {result.ratingModelVersion} · deterministic. The same roster always earns the
        same record.
      </Text>
    </View>
  );

  return (
    <Screen maxWidth={layout.wide ? 760 : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Layer t={line.t} at={CUE.plate} distance={0} style={styles.header}>
          <Brand size={22} tint={perfect ? color.goldBright : undefined} />
          <Pressable
            onPress={() => router.replace(homeRoute())}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </Layer>

        {verdict}
        {detail}
      </ScrollView>

      {/* Rendered off-screen at a fixed size so the captured image is identical
          on every device, and hidden from assistive tech. */}
      <View
        style={styles.captureHost}
        pointerEvents="none"
        collapsable={false}
        {...DECORATIVE}
      >
        <ShareCard ref={cardRef} result={result} roster={shareRows} assisted={game.assisted} />
      </View>

      {/* Last child so it sits over everything, and pointer-transparent so it
          cannot swallow the Share or Build Another buttons underneath. */}
      {onAir ? (
        <Celebration intensity={celebration} palette={[accent, color.text, color.silver]} perfect={perfect} />
      ) : null}
    </Screen>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={[styles.lineValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  blank: { flex: 1 },
  scroll: { paddingHorizontal: space.lg, paddingBottom: 60, gap: space.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.sm,
  },
  close: {
    fontFamily: font.body,
    fontSize: 18,
    color: color.textDim,
    minWidth: 44,
    minHeight: 44,
    lineHeight: 44,
    textAlign: 'center',
  },

  verdictColumn: { gap: space.md, width: '100%' },
  detailColumn: { gap: space.md, width: '100%' },

  chase: {
    borderWidth: 1,
    borderColor: color.lineGold,
    backgroundColor: `${color.gold}0A`,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  chaseHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  chaseLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.gold,
    textTransform: 'uppercase',
  },
  chaseValue: { fontFamily: font.display, fontSize: 26, color: color.text, ...tabular },
  chaseHeadline: {
    fontFamily: font.body,
    fontSize: 14,
    color: color.goldBright,
    textAlign: 'center',
    lineHeight: 20,
  },
  chaseCopy: { fontFamily: font.bodyRegular, fontSize: 12.5, color: color.textDim, lineHeight: 18 },
  meter: { height: 6, borderRadius: 3, backgroundColor: '#FFFFFF0F', overflow: 'hidden' },
  meterFill: {
    height: 6,
    width: '100%',
    borderRadius: 3,
    backgroundColor: color.gold,
    transformOrigin: 'left',
  },

  denied: {
    borderWidth: 1,
    borderColor: `${color.negative}4D`,
    backgroundColor: `${color.negative}0F`,
    borderRadius: radius.md,
    padding: space.lg,
    gap: 4,
  },
  deniedTitle: {
    fontFamily: font.display,
    fontSize: 18,
    letterSpacing: tracking.wide,
    color: color.negative,
    textTransform: 'uppercase',
  },
  deniedGate: { fontFamily: font.body, fontSize: 13, color: color.text },

  badgeRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  badge: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 4,
  },
  badgeText: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: color.textDim,
    textTransform: 'uppercase',
  },
  badgeBlind: { borderColor: '#C49BFF66', backgroundColor: '#C49BFF14' },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF06',
  },
  boardText: { flex: 1, minWidth: 0, gap: 1 },
  boardTitle: { fontFamily: font.bodyBold, fontSize: 14, color: color.text },
  boardCopy: { fontFamily: font.bodyRegular, fontSize: 11, lineHeight: 15, color: color.textFaint },
  boardToggle: {
    paddingVertical: 5,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
  },
  boardToggleOff: { borderColor: `${color.gold}66`, backgroundColor: `${color.gold}14` },
  boardToggleText: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: color.textDim,
  },
  boardToggleTextOff: { color: color.gold },
  badgeBlindText: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: '#C49BFF',
    textTransform: 'uppercase',
  },

  standing: {
    gap: 3,
    alignItems: 'flex-start',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.lineGold,
    backgroundColor: color.goldGlow,
  },
  standingTitle: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.gold,
  },
  standingCopy: { fontFamily: font.bodyRegular, fontSize: 12, lineHeight: 17, color: color.textDim },
  standingLink: {
    marginTop: 4,
    paddingVertical: 5,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
  },
  standingLinkLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.silver,
  },

  actions: { flexDirection: 'row', gap: space.sm },
  lift: { transform: [{ translateY: -1 }] },
  primary: {
    flex: 1.4,
    backgroundColor: color.action,
    borderRadius: radius.md,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.action,
    shadowOpacity: 0.5,
    ...elevate(8),
  },
  primaryLabel: {
    fontFamily: font.display,
    fontSize: 19,
    letterSpacing: tracking.wide,
    color: color.onAction,
    textTransform: 'uppercase',
  },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontFamily: font.display,
    fontSize: 19,
    letterSpacing: tracking.wide,
    color: color.text,
    textTransform: 'uppercase',
  },
  note: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textDim, textAlign: 'center' },

  panel: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space.lg,
    backgroundColor: '#FFFFFF05',
  },
  panelTitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
    marginBottom: space.sm,
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  rosterSlot: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, width: 38 },
  rosterMain: { flex: 1, minWidth: 0 },
  rosterName: { fontFamily: font.heading, fontSize: 16, color: color.text },
  rosterMeta: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },

  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  lineLabel: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim, flex: 1 },
  lineValue: { fontFamily: font.display, fontSize: 15, color: color.text, ...tabular },
  footnote: {
    fontFamily: font.bodyRegular,
    fontSize: 11,
    color: color.textFaint,
    marginTop: space.sm,
  },

  chemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: 5,
  },
  chemLabel: { fontFamily: font.bodyRegular, fontSize: 12.5, color: color.textDim, flex: 1 },
  chemValue: { fontFamily: font.display, fontSize: 13, ...tabular },

  modelNote: {
    fontFamily: font.bodyRegular,
    fontSize: 10,
    color: color.textFaint,
    textAlign: 'center',
    lineHeight: 15,
  },
  captureHost: { position: 'absolute', left: -10000, top: 0, opacity: 0 },
}));
