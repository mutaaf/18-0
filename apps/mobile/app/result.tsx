import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTV, pressVerb } from '@/features/tv/platform';
import { cue } from '@/features/tv/sound';
import { FocusPane } from '@/features/tv/FocusPane';
import { BroadcastReveal, SLAM, broadcastOn, useBroadcast } from '@/features/tv/hud';
import { Animated, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/Pressable';
import { useRouter } from 'expo-router';
import * as Haptics from '@/features/haptics';
import { ROSTER_SLOTS, isPerfectionDenied, type RosterSlot } from '@17-0/domain';
import { displayName, eraLabel, franchise } from '@17-0/data';
import { Brand } from '@/components/Brand';
import { EASE_OUT, Layer, SkipLayer, keyframes, useTimeline } from '@/components/Broadcast';
import { CUE, ROSTER_STEP, Scoreboard } from '@/components/Scoreboard';
import { Celebration } from '@/components/Celebration';
import { StadiumLights } from '@/features/tv/lights';
import { Screen } from '@/components/Screen';
import { SpreadLayout } from '@/components/SpreadLayout';
import { useSpread } from '@/features/fold';
import { RatingBadge } from '@/components/RatingBadge';
import { ShareCard, type ShareRosterRow } from '@/components/ShareCard';
import { AdSlot } from '@/components/AdSlot';
import { betweenSeasons } from '@/features/ads';
import { SLOT_RESULTS } from '@/features/ads-policy';
import { homeRoute, isEmbedded, tellHost } from '@/features/embed';
import { standing } from '@/features/frame-standing';
import { APP_URL_LABEL, prepareWebShareFile, shareAvailable, shareResult, type ShareOutcome } from '@/features/share';
import { track } from '@/features/telemetry';
import { askForReminders, scheduleStreakReminder } from '@/features/reminders';
import { currentUser, hideSeason } from '@/services/supabase';
import { useFlag } from '@/features/flags';
import {
  feedbackKey,
  flushRatingFeedback,
  giveRatingFeedback,
  useRatingFeedback,
  type RatingVerdict,
} from '@/features/rating-feedback';
import { useShallow } from 'zustand/react/shallow';
import { lookupCard, useGameStore } from '@/state/game';
import { useNextSeason, useStartGame } from '@/features/start-game';
import { MODE_LABEL } from '@/state/next-season';
import { LensNudge } from '@/components/LensNudge';
import { GutCheckEntry } from '@/components/GutCheckEntry';
import { RESPIN_MARK } from '@17-0/respins/client';
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
  teamInk,
  tierColor,
  tracking,
  type PressState,
  useLayout,
  useThemeId,
} from '@/theme';

/**
 * The reveal does two jobs: land the result hard, and make the next spin feel
 * inevitable. So the distance from 17-0 is the second thing on the page rather
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

/** How long after the broadcast record slams the page under it mounts: once the spring has landed. */
const PAGE_AFTER_SLAM = 400;

/** What the screen says after a share. Null says nothing. */
const SHARE_NOTE: Record<ShareOutcome, string | null> = {
  image: null,
  link: null,
  cancelled: null,
  text: 'Shared as text. The image could not be made.',
  copied: 'Copied your record and the link. Paste it anywhere.',
  failed: `This browser blocked sharing. The link is ${APP_URL_LABEL}`,
};

export default function Result() {
  const { spread, ref: spreadRef, onLayout: onSpreadLayout, measured } = useSpread();
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
  // The fields this screen reads. The whole store re-rendered the result -- the
  // record, the scoreboard, the celebration -- on every write, including the
  // ones that start the next season underneath it.
  const game = useGameStore(
    useShallow((s) => ({
      result: s.result,
      selections: s.selections,
      assisted: s.assisted,
      mode: s.mode,
      respinsUsed: s.respinsUsed,
      serverSessionId: s.serverSessionId,
    })),
  );
  const history = useHistoryStore((s) => s.games);
  const result = game.result;

  const cardRef = useRef<View>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  // "Rate the ratings": folded away until a player asks for it, so a finished
  // season reads as a result and not a survey. See features/rating-feedback.
  const ratingFeedback = useFlag('rating_feedback');
  const [rating, setRating] = useState(false);
  const verdicts = useRatingFeedback((s) => s.verdicts);
  useEffect(() => {
    // Anything voted while offline goes now.
    void flushRatingFeedback();
  }, []);
  /** The card as a file, made before the tap on a browser whose share sheet takes one. */
  const shareFile = useRef<File | null>(null);
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

  /**
   * Apple TV, broadcast mode: the record is a full-screen graphic over this
   * page until Select (features/tv/hud). Known here, on the first render, so
   * nothing renders twice to find out.
   */
  const broadcast = useBroadcast();
  const [recordDone, setRecordDone] = useState(false);
  const revealUp = broadcast && !recordDone;
  // Whether this screen opened under the record. Latched: the page's clock
  // is decided once, at mount.
  const [underRecord] = useState(revealUp);

  /**
   * The page under the broadcast record mounts once the record has slammed
   * down, not with the screen (docs/apple-tv.md, "The fifth pass").
   *
   * It was the whole of the screen's first commit -- the scoreboard, the
   * roster, both panels, the confetti and the share card -- behind an opaque
   * graphic nobody could see through -- and built five times over as the
   * screen measured itself -- while a real Apple TV took a second and a half
   * to the reveal's first frame. Now the
   * first commit is the graphic, and the page arrives in the hold after the
   * slam, when the JS thread has nothing else to do and every moving part of
   * the record is on the UI thread. It mounts built (`from: 'end'`): its
   * choreography played behind the glass before, where nobody saw it. Select
   * before then brings it at once, under the graphic's fade.
   */
  const [pageDue, setPageDue] = useState(!revealUp);
  const closeRecord = useCallback(() => setPageDue(true), []);
  const recordGone = useCallback(() => setRecordDone(true), []);
  useEffect(() => {
    if (pageDue) return;
    if (!revealUp) {
      setPageDue(true);
      return;
    }
    const at = setTimeout(() => setPageDue(true), SLAM + PAGE_AFTER_SLAM);
    return () => clearTimeout(at);
  }, [pageDue, revealUp]);

  /**
   * On a TV the page is a book (two pages, `SpreadLayout`), and the spread is
   * a single page until this screen has been measured: built straight away,
   * the whole page was built as one column and then again as two, in the
   * frames the result was arriving. So a TV waits the frame for the
   * measurement, and no longer than a few: the layers are all still at their
   * first, invisible keyframe then.
   */
  const [measureLate, setMeasureLate] = useState(false);
  useEffect(() => {
    if (!isTV || measured) return;
    const at = setTimeout(() => setMeasureLate(true), 120);
    return () => clearTimeout(at);
  }, [measured]);
  const pageShown = pageDue && (!isTV || measured || measureLate);

  // One clock for the whole page. Read before the early return below, so the
  // hook order never changes.
  const line = useTimeline(CUE.end, result?.finalRating, { from: underRecord ? 'end' : 'start' });

  /**
   * The card image, captured once the build has finished and before anybody
   * reaches for Share. On the tap it is too late: Safari stops treating the
   * tap as a gesture during the capture and refuses the share sheet
   * (`webShareRoute` in features/share-text.ts). Web only; null elsewhere.
   */
  useEffect(() => {
    if (!line.settled || !result) return;
    let live = true;
    shareFile.current = null;
    const at = setTimeout(() => {
      void prepareWebShareFile(cardRef, result).then((file) => {
        if (live) shareFile.current = file;
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(at);
    };
  }, [line.settled, result?.finalRating]);

  /**
   * The share card mounts once the screen is up, not with it.
   *
   * It is a whole second roster, drawn off-screen for the capture, and it was
   * part of the one commit that put the result on the glass -- the longest
   * single task of the season. It is not needed before the buttons appear
   * (`CUE.tail`), so it arrives while the digits roll, which run on the native
   * driver and do not wait for the JS thread. A skip settles the page at once
   * and brings it with it.
   */
  const [captureDue, setCaptureDue] = useState(false);
  useEffect(() => {
    const at = setTimeout(() => setCaptureDue(true), CUE.digits);
    return () => clearTimeout(at);
  }, []);
  // Never on an Apple TV, which has nowhere to share to (`shareAvailable`):
  // it was a second roster mounted off-screen for a capture that never comes.
  const captureMounted = shareAvailable && pageShown && (captureDue || line.settled);

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
      // The TV's sound for the same frame (a no-op anywhere else). Broadcast
      // mode runs its own longer reveal with its own sounds, over this one.
      if (!broadcastOn()) {
        cue(result.ending.key === 'PERFECT' ? 'perfect' : isPerfectionDenied(result) ? 'denied' : 'stamp');
      }
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
    setShareNote(null);
    const context = { wins, brag, platform: Platform.OS };
    track('share_tapped', context);
    void shareResult(cardRef, result, shareRows, shareFile.current, { respun: game.respinsUsed > 0 }).then((outcome) => {
      setShareNote(SHARE_NOTE[outcome]);
      // Every outcome, cancelled included: a tap that ends in a closed sheet
      // is the most useful number this event can have.
      track('result_shared', { ...context, outcome });
    });
  };

  const { playNext } = useStartGame();
  const next = useNextSeason();
  const buildAnother = async () => {
    // Web only, capped, and resolved at once with no fill (features/ads.ts).
    // Before the start, so a break never sits on top of a spinning reel.
    await betweenSeasons();
    // The same way in as Play on the front page: the lens last started, the
    // ranked switch as the player left it, and the first wheel already
    // spinning (state/next-season.ts). This used to call startGame() bare,
    // which defaults to unranked -- so a ranked player who pressed Build
    // Another was quietly playing for nothing from their second season on.
    // After a gameday or a challenge it is the lens the player last chose,
    // never the one-off: that is the rule every Play button follows.
    await playNext({ replace: true });
  };

  // Confetti over a 4-13 would read as mockery, so the celebration only starts
  // once the season is one worth celebrating, and grows from there.
  const celebration = perfect ? 1 : wins >= 17 ? 0.92 : wins >= 15 ? 0.7 : wins >= 12 ? 0.45 : wins >= 10 ? 0.25 : 0;

  const beatBest = previousBest !== null && result.finalRating > previousBest;

  /**
   * A season worth posting gets Share as the main button, with the record on
   * it. Dozens of people a day finished seasons and nobody posted one: Share
   * was the quiet button beside a bright green Build Another, and the moment
   * somebody is proudest of a result is the moment to hand them the button.
   */
  // A personal best only earns the big Share button when it is also a winning
  // season: a new player's first 2-15 can be their best yet, and "Post your
  // 2-15" was not the moment anyone wants to be handed.
  // Never on an Apple TV, which has nowhere to post to (shareAvailable).
  const brag = shareAvailable && (perfect || heartbreak || wins >= 12 || (beatBest && wins >= 10));
  const recordText = `${wins}-${result.record.losses}`;

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
              <Text style={styles.chaseLabel}>Distance from 17-0</Text>
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
                    ? `A new personal best. ${previousBest!.toFixed(1)} was the mark. Go again.`
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

      {game.mode === 'player_iq' || game.assisted || game.respinsUsed > 0 ? (
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
          {game.respinsUsed > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{RESPIN_MARK} Respin used · marked on the boards</Text>
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
        {brag ? (
          <>
            <Pressable
              style={({ pressed, hovered }: PressState) => [
                styles.primary,
                hovered && styles.lift,
                pressed && { opacity: 0.88 },
              ]}
              onPress={share}
              accessibilityRole="button"
              accessibilityLabel="Share this result"
              accessibilityHint={`Posts your ${recordText} season`}
            >
              <Text style={styles.primaryLabel} numberOfLines={1} adjustsFontSizeToFit>
                Post your {recordText}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed, hovered }: PressState) => [
                styles.secondary,
                hovered && { borderColor: color.gold },
                pressed && { opacity: 0.85 },
              ]}
              onPress={buildAnother}
              accessibilityRole="button"
              accessibilityLabel="Build another roster"
              accessibilityHint={`Starts a ${MODE_LABEL[next.mode]} season`}
            >
              <Text style={styles.secondaryLabel} numberOfLines={1}>Again</Text>
              <Text style={styles.secondarySub} numberOfLines={1}>{MODE_LABEL[next.mode]}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              style={({ pressed, hovered }: PressState) => [
                styles.primary,
                hovered && styles.lift,
                pressed && { opacity: 0.88 },
              ]}
              onPress={buildAnother}
              // The remote starts on "again" when the season is over.
              // Not while broadcast mode's full-screen record is up: the
              // later claim wins, and a click meant to dismiss the graphic
              // started a new season through it.
              hasTVPreferredFocus={!revealUp}
              accessibilityRole="button"
              accessibilityLabel="Build another roster"
              accessibilityHint={`Starts a ${MODE_LABEL[next.mode]} season`}
            >
              <Text style={styles.primaryLabel} numberOfLines={1}>Build Another</Text>
              {/* Which lens it starts, so the jump is never a surprise
                  (state/next-season.ts). */}
              <Text style={styles.primarySub} numberOfLines={1}>{MODE_LABEL[next.mode]}</Text>
            </Pressable>
            {shareAvailable ? (
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
                <Text style={styles.secondaryLabel}>Share {recordText}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </Layer>

      {/* "Try GM Mode?" / "Try Rookie?" from the last few seasons in this lens:
          right where the evidence was just made. Hidden after "Not now". */}
      <LensNudge replace />

      {shareNote ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {shareNote}
        </Text>
      ) : null}

      {/* Below the actions, so it can never take the press meant for Build
          Another. Web only. Its height is held while the ad loads, so a fill
          never shoves the roster down under somebody's thumb, and it
          collapses when there is no fill. */}
      <AdSlot id={SLOT_RESULTS} />
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
        <View style={styles.panelHead}>
          <Text style={[styles.panelTitle, styles.panelTitleInline]}>Roster</Text>
          {ratingFeedback ? (
            <Pressable
              onPress={() => setRating((on) => !on)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ expanded: rating }}
              accessibilityLabel={rating ? 'Done rating the ratings' : 'Rate the ratings'}
            >
              {({ hovered }: PressState) => (
                <Text style={[styles.rateToggle, (hovered || rating) && styles.rateToggleOn]}>
                  {rating ? 'Done' : 'Ratings look off?'}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
        {rating ? (
          <Text style={styles.rateHint}>
            ▲ if a season deserves more, ▼ if less. It goes into the next model, never this score.
          </Text>
        ) : null}
        {rating ? <GutCheckEntry inline /> : null}
        {rosterCards.map(({ slot, card }, index) => (
          <Layer key={slot} t={line.t} at={CUE.roster + index * ROSTER_STEP}>
            {/* Every name in the app opens its card. A player who has just
                been told a roster scored 92.6 will want to look at the seven
                seasons that did it. */}
            {/* The arrows sit beside the row's press target rather than in it:
                a button inside a button is invalid on the web, and React says
                so on every render. */}
            <View style={styles.rosterLine}>
            <Pressable
              onPress={() => router.push(`/card/${encodeURIComponent(card.id)}`)}
              style={({ hovered, pressed }: PressState) => [
                styles.rosterRow,
                styles.rosterPress,
                hovered && { backgroundColor: '#FFFFFF0A' },
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${slot}. ${displayName(card)}. ${card.year} ${franchise(card.franchiseId).name}. Rating ${card.rating.toFixed(1)}. ${pressVerb} for the card.`}
            >
            <Text style={[styles.rosterSlot, { color: positionColor[card.position] }]}>{slot}</Text>
            <View style={styles.rosterMain}>
              <Text style={styles.rosterName} numberOfLines={1}>
                {displayName(card)}
              </Text>
              <Text style={styles.rosterMeta} numberOfLines={1}>
                <Text style={[styles.rosterTeam, { color: teamInk(franchise(card.franchiseId).color) }]}>
                  {franchise(card.franchiseId).abbr} {card.year}
                </Text>
                {'  ·  '}
                {eraLabel(card.era)}
              </Text>
            </View>
            {rating ? null : <RatingBadge rating={card.rating} size="sm" />}
            </Pressable>
            {rating ? (
              <Verdicts
                name={displayName(card)}
                current={verdicts[feedbackKey(result.ratingModelVersion, card.id)]}
                onVerdict={(verdict) =>
                  giveRatingFeedback({
                    cardId: card.id,
                    modelVersion: result.ratingModelVersion,
                    ratingShown: card.rating,
                    verdict,
                  })
                }
              />
            ) : null}
            {rating ? (
              <View style={styles.badgeSlot}>
                <RatingBadge rating={card.rating} size="sm" />
              </View>
            ) : null}
            </View>
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

  const header = (
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
  );

  // Open as a book, the record and its verdict take one page and the roster
  // with how it scored the other: one column down the middle put the crease
  // through the record.
  const paged = spread.kind !== 'single';

  return (
    <Screen maxWidth={paged ? undefined : layout.wide ? 760 : undefined} bleed={paged}>
      <View ref={spreadRef} onLayout={onSpreadLayout} style={styles.fill}>
        {!pageShown ? null : paged ? (
          <SpreadLayout
            spread={spread}
            // On a TV each page is a focus guide, or left and right could
            // not cross between them (FocusPane).
            first={
              <FocusPane>
                <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                  {header}
                  {verdict}
                </ScrollView>
              </FocusPane>
            }
            second={
              <FocusPane>
                <ScrollView contentContainerStyle={[styles.scroll, styles.scrollSecond]} showsVerticalScrollIndicator={false}>
                  {detail}
                </ScrollView>
              </FocusPane>
            }
          />
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {header}
            {verdict}
            {detail}
          </ScrollView>
        )}
      </View>

      {/* Rendered off-screen at a fixed size so the captured image is identical
          on every device, and hidden from assistive tech. */}
      <View
        style={styles.captureHost}
        pointerEvents="none"
        collapsable={false}
        {...DECORATIVE}
      >
        {captureMounted ? (
          <ShareCard ref={cardRef} result={result} roster={shareRows} assisted={game.assisted} respun={game.respinsUsed > 0} />
        ) : null}
      </View>

      {/* Last child so it sits over everything, and pointer-transparent so it
          cannot swallow the Share or Build Another buttons underneath.

          The celebration is not its own event. Started with the screen it threw
          confetti over a panel that had not finished building and a record that
          still said 0-0; it belongs to the frame the tier stamps on, after the
          record has locked and buzzed. It is mounted now and goes off on that
          cue by itself, so the cue costs this screen no re-render and the show
          has done its setup before its first frame (see `Celebration`). */}
      {/* On a TV, not under the broadcast record: the page's confetti there
          was a hundred animated views behind an opaque graphic. Dismissing
          the record lets it go off, if its moment has not passed. */}
      {pageShown ? (
      <Celebration
        intensity={isTV && revealUp ? 0 : celebration}
        palette={[accent, color.text, color.silver]}
        perfect={perfect}
        at={line.settled ? 0 : CUE.stamp}
      />
      ) : null}
      {/* Apple TV: the stadium lights on the stamp, when the broadcast record
          is not already lighting it (features/tv/lights.tsx). */}
      {celebration > 0 && !revealUp && !broadcast ? (
        <StadiumLights show={perfect ? 'perfect' : 'reveal'} cue="page" at={line.settled ? 0 : CUE.stamp} tint={accent} bleed />
      ) : null}

      {/* Apple TV, broadcast mode: the record as a full-screen graphic before
          the page underneath (features/tv/hud), until it has faded out. */}
      {revealUp ? (
        <BroadcastReveal result={result} mode={game.mode} roster={shareRows} onClose={closeRecord} onDone={recordGone} />
      ) : null}
    </Screen>
  );
}

/**
 * Two small arrows beside a rating. Tapping the lit one again takes the
 * opinion back, so a mis-tap costs nothing.
 */
function Verdicts({
  name,
  current,
  onVerdict,
}: {
  name: string;
  current: RatingVerdict | undefined;
  onVerdict: (verdict: RatingVerdict | null) => void;
}) {
  const tap = (verdict: RatingVerdict) => {
    Haptics.selectionAsync().catch(() => {});
    onVerdict(current === verdict ? null : verdict);
  };
  return (
    <View style={styles.verdicts}>
      <Pressable
        onPress={() => tap('too_low')}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityState={{ selected: current === 'too_low' }}
        accessibilityLabel={`${name} deserves a higher rating`}
        style={[styles.verdict, current === 'too_low' && styles.verdictUp]}
      >
        <Text style={[styles.verdictGlyph, current === 'too_low' && { color: color.positive }]}>▲</Text>
      </Pressable>
      <Pressable
        onPress={() => tap('too_high')}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityState={{ selected: current === 'too_high' }}
        accessibilityLabel={`${name} deserves a lower rating`}
        style={[styles.verdict, current === 'too_high' && styles.verdictDown]}
      >
        <Text style={[styles.verdictGlyph, current === 'too_high' && { color: color.negative }]}>▼</Text>
      </Pressable>
    </View>
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
  scrollSecond: { paddingTop: space.lg },
  fill: { flex: 1 },
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
  primarySub: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, color: color.onAction, textTransform: 'uppercase', opacity: 0.8 },
  secondarySub: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, color: color.textDim, textTransform: 'uppercase' },
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
  rosterLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  rosterPress: { flex: 1, minWidth: 0, borderBottomWidth: 0 },
  // Badges differ in width by a digit; a fixed slot keeps every row's arrows
  // in one column.
  badgeSlot: { width: 58, alignItems: 'flex-end' },
  panelHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space.sm },
  panelTitleInline: { marginBottom: 0 },
  rateToggle: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, textDecorationLine: 'underline' },
  rateToggleOn: { color: color.silver },
  rateHint: { fontFamily: font.bodyRegular, fontSize: 11, lineHeight: 16, color: color.textDim, marginBottom: space.xs },
  verdicts: { flexDirection: 'row', gap: 6 },
  verdict: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verdictUp: { borderColor: color.positive, backgroundColor: color.actionGlow },
  verdictDown: { borderColor: color.negative, backgroundColor: '#FFFFFF08' },
  verdictGlyph: { fontSize: 11, color: color.textFaint },
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
  rosterTeam: { fontFamily: font.displayBlack, fontSize: 13, letterSpacing: 0.5 },
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

export { RouteError as ErrorBoundary } from '@/components/RouteError';
