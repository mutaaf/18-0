import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { RankedSwitch } from '@/components/RankedSwitch';
import Svg, { Path } from 'react-native-svg';
import { Reveal } from '@/components/Reveal';
import { ROSTER_SLOTS } from '@18-0/domain';
import { DATASET, gamedayAt, type Gameday } from '@18-0/data';
import { Billboard } from '@/components/Billboard';
import { Brand } from '@/components/Brand';
import { GamedayHero, gamedayMarqueeDay } from '@/components/GamedayHero';
import { Crown } from '@/components/Crown';
import { Hall } from '@/components/Hall';
import { Screen } from '@/components/Screen';
import { SectionHead } from '@/components/SectionHead';
import { GetTheApp } from '@/components/GetTheApp';
import { OnWatch } from '@/components/OnWatch';
import { LeaderboardStrip } from '@/components/LeaderboardStrip';
import { Panel } from '@/components/Panel';
import { track } from '@/features/telemetry';
import { beginRanked } from '@/features/ranked';
import { useStartGame, withTimeout } from '@/features/start-game';
import { flag, useFlag } from '@/features/flags';
import { fetchGamedaySummary, isBackendConfigured, type GamedaySummary } from '@/services/supabase';
import { useGameStore, type GameMode } from '@/state/game';
import { computeStats, useHistoryStore } from '@/state/history';
import { MODE_LABEL } from '@/state/game';
import {
  color,
  elevate,
  font,
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

export default function Home() {
  // Subscribes this screen to the palette. React Navigation memoizes the
  // element it was handed, so a theme change reaches the component that
  // *creates* this screen's children or it reaches nothing -- which showed up
  // as a repainted picker sitting inside a screen still wearing the old
  // colours. `theme.test.ts` asserts every route does this.
  useThemeId();
  const router = useRouter();
  const layout = useLayout();
  const game = useGameStore();
  const games = useHistoryStore((s) => s.games);
  const stats = useMemo(() => computeStats(games), [games]);
  /**
   * On by default now, and the switch is gone from the way in.
   *
   * It used to be off, on the reasoning that the offline game is the product
   * and the leaderboard is the reason to go online rather than a tax on
   * everyone else. That reasoning was right about the game and wrong about the
   * cost: reaching a board took a toggle *and* a mode card, and the toggle sat
   * above the thing people came to press. Two deliberate acts to be counted,
   * one to be forgotten.
   *
   * So ranked is what happens unless it cannot. `beginRanked` already falls
   * back to a local game and says why when the server does not answer in eight
   * seconds, which is the same thing the toggle used to buy -- without asking
   * anybody to predict their own connection before the first spin.
   *
   * Nothing about integrity moves: the mode is still declared before the first
   * spin and still immutable afterwards. What changes afterwards is only
   * whether a finished season is *shown*, which is safe in the one direction
   * the result screen offers it.
   */
  const [ranked, setRanked] = useState(true);
  // Two things can be opening a ranked session: a mode card, which goes
  // through the shared hook, and the gameday marquee, which does not --
  // gameday always tries the server whatever the switch says. The switch is
  // busy while either is in flight.
  const { start, opening: startingMode } = useStartGame();
  const [openingGameday, setOpeningGameday] = useState(false);
  const opening = startingMode || openingGameday;
  /** How today's board is doing, when there is one and a server to ask. */
  const [gameday, setGameday] = useState<GamedaySummary | null>(null);
  const [gamedayNote, setGamedayNote] = useState<string | null>(null);

  useEffect(() => {
    track('app_opened', { games: games.length });
  }, []);

  // Asked once, and only when there is a gameday to ask about. The panel draws
  // itself from the bundled calendar either way, so a failure here costs a
  // line of copy rather than the whole marquee.
  useEffect(() => {
    // The kill switch as well as the calendar: a mode that is switched off
    // should cost nothing, including a request nobody will see the answer to.
    if (!isBackendConfigured || !flag('gameday') || !gamedayAt()) return;
    void fetchGamedaySummary(null)
      .then(setGameday)
      .catch(() => setGameday(null));
  }, []);

  /**
   * Resume only offers itself when there is something worth resuming. A game
   * that was started and never played is not progress — it was clutter on the
   * one screen that should be a single obvious decision.
   */
  const inProgress = game.status !== 'idle' && game.selections.length > 0
    && game.selections.length < ROSTER_SLOTS.length;

  /**
   * Into the gameday.
   *
   * Always tries to play it against the server, whatever the ranked switch
   * says: a gameday is a shared board and a board needs the server to issue
   * the spins. If the server cannot be reached the game still starts -- the
   * calendar is bundled, so the restricted wheel works offline -- and the
   * panel says plainly that the season will not reach the board, which is
   * better than refusing to let somebody play at all.
   */
  const startGameday = async (day: Gameday) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    setGamedayNote(null);
    track('play_started', { mode: 'gameday', ranked: isBackendConfigured, gameday: day.key });
    game.startGame('gameday', { ranked: isBackendConfigured });

    if (isBackendConfigured) {
      setOpeningGameday(true);
      try {
        const opened = await withTimeout(beginRanked('gameday'), 8000);
        if (opened?.ok) {
          game.attachServerSession(opened.value.sessionId, opened.value.idempotencyKey);
          track('gameday_started', { gameday: day.key });
        } else {
          const reason = opened?.message ?? 'The server did not answer in time.';
          game.downgrade(reason);
          setGamedayNote(`${reason} This season stays on this device.`);
          track('ranked_downgraded', { reason, mode: 'gameday' });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Gameday could not start.';
        game.downgrade(reason);
        setGamedayNote(`${reason} This season stays on this device.`);
        track('ranked_downgraded', { reason, mode: 'gameday' });
      } finally {
        setOpeningGameday(false);
      }
    }
    router.push('/play');
  };

  const resume = () => {
    track('game_resumed', { filled: game.selections.length, mode: game.mode });
    router.push('/play');
  };

  const discard = () => {
    track('game_abandoned', { filled: game.selections.length });
    game.abandon();
  };

  /**
   * A gameday marquee is about to sit under the board, and it is three hundred
   * points of panel with its own way into a game. Two hero-sized objects
   * stacked on a phone put the mode cards off the bottom of the screen, and the
   * one thing the front page may not do is bury the way in. So on a gameday the
   * board gives up its scoreboard rail and a few points of headline: the
   * marquee is carrying the numbers and the urgency that day, and the billboard
   * goes back to being a sign.
   *
   * `gamedayMarqueeDay` is the marquee's own predicate, imported rather than
   * reimplemented, so the board cannot shrink on a day the slab does not
   * appear.
   *
   * `useFlag` rather than `flag`, and that is not a style preference. `flag` is
   * a snapshot: an unresolved flag reads as its fallback, this screen does not
   * subscribe to the resolution, and the board would keep whichever answer it
   * happened to get on the first frame forever. It did exactly that in the
   * exported web build -- `gameday` defaults on, PostHog had not answered yet,
   * and a landing page with no marquee anywhere on it was missing its
   * scoreboard rail because it was making room for one. The hook is what
   * GamedayHero reads, so the two now flip in the same render.
   */
  const marquee = useFlag('gameday') && gamedayMarqueeDay() !== null;

  /**
   * The headline size, measured rather than guessed.
   *
   * "Chase perfection." is the longest line and Rajdhani Bold renders it at
   * almost exactly 7.2 points of width per point of size -- the only number in
   * this calculation that is not arbitrary, measured in the browser at five
   * sizes, where it did not move. The board's own padding comes off the column
   * before the type gets any, so the space the headline actually has on a
   * narrow screen is the viewport less fifty: the content gutter, less the
   * bleed the board wins back, less its padding and its border.
   *
   * A fixed size per breakpoint was wrong at both ends of the phone range. One
   * that fits a 390-point screen runs a headline through the wall of bulbs on a
   * 320-point one; one that fits 320 is timid at 430 and absurd on an 800-point
   * tablet, which is still the narrow layout. The divisor carries a six per
   * cent margin, because a face that has not finished loading measures as the
   * fallback and this runs before that is settled.
   *
   * The two wide values are constants because their columns are: between 900
   * and 1180 the content is one bounded column and the board has about 850
   * points of type to play with; past 1180 the aside moves alongside and it has
   * about 610. That is why the headline gets *smaller* as the window crosses
   * 1180 -- the column it lives in did too.
   */
  const display = layout.roomy
    ? 78
    : layout.wide
      ? 92
      : Math.min(marquee ? 40 : 56, Math.round((layout.width - 50) / 7.65));

  const hero = (
    <View style={styles.heroColumn}>
      <Reveal delay={0}>
        <Billboard
          kicker="The pro football history game"
          columns={layout.wide ? 4 : 2}
          bleed={layout.wide ? 0 : space.lg}
          padding={layout.roomy ? space.xl : space.lg}
          stats={marquee ? [] : [
            {
              value: DATASET.cards.length.toLocaleString(),
              label: `Rated seasons · ${DATASET.coverage.firstSeason}–${DATASET.coverage.lastSeason}`,
            },
            { value: String(DATASET.combos.length), label: 'Franchise-eras' },
            { value: String(ROSTER_SLOTS.length), label: 'Spins a season' },
            // The only number on the front page that is a *claim* rather than a
            // count of the bundled data, and the reason the game exists. It is
            // a function of the calibration curve: if the card pool grows and
            // the curve is not refitted, this line quietly stops being true --
            // see docs/scoring-model.md.
            { value: '1 in 6,000', label: 'Odds of 18-0', gold: true },
          ]}
        >
          <Text style={[styles.headline, { fontSize: display, lineHeight: display * 0.98 }]}>
            Spin history.{'\n'}Build seven.{'\n'}
            <Text style={styles.headlineAccent}>Chase perfection.</Text>
          </Text>
        </Billboard>
      </Reveal>


      {/* The marquee, above everything it competes with. It removes itself
          when the next gameday is more than a week out, so the front page is
          not counting down to September in March. */}
      <Reveal delay={60}>
        <GamedayHero
          summary={gameday}
          busy={opening}
          note={gamedayNote}
          onEnter={startGameday}
        />
      </Reveal>

      {inProgress ? (
        <Reveal delay={80} style={styles.resume}>
          <View style={styles.resumeTrack}>
            <View
              style={[
                styles.resumeFill,
                { width: `${(game.selections.length / ROSTER_SLOTS.length) * 100}%` },
              ]}
            />
          </View>
          <View style={styles.resumeBody}>
            <View style={styles.resumeMain}>
              <Text style={styles.resumeTitle}>Resume your game</Text>
              <Text style={styles.resumeMeta}>
                {game.selections.length} of {ROSTER_SLOTS.length} filled ·{' '}
                {MODE_LABEL[game.mode]}
              </Text>
            </View>
            <Pressable
              onPress={resume}
              accessibilityRole="button"
              accessibilityLabel={`Resume game, ${game.selections.length} of seven filled`}
              style={({ hovered }: PressState) => [styles.resumeGo, hovered && styles.lift]}
            >
              <Text style={styles.resumeGoLabel}>Resume</Text>
            </Pressable>
            <Pressable
              onPress={discard}
              accessibilityRole="button"
              accessibilityLabel="Discard the game in progress"
              style={styles.discard}
            >
              <Text style={styles.discardLabel}>Discard</Text>
            </Pressable>
          </View>
        </Reveal>
      ) : null}

      <Reveal delay={120}>
        <SectionHead
          label="Pick your lens"
          note="Same wheel, same seven slots, same scoring. What changes is how much the card is willing to tell you."
        />
      </Reveal>

      <Reveal delay={140} style={styles.modes}>
        <ModeCard
          name={MODE_LABEL.scout}
          badge="Stats only"
          copy="The stat line, no rating. Read the numbers and judge."
          hero
          onPress={() => start('scout', { ranked })}
        />
        <ModeCard
          name={MODE_LABEL.player_iq}
          badge="Blind"
          copy="No stat line either. Just a name, a team and a year."
          onPress={() => start('player_iq', { ranked })}
        />
        <ModeCard
          name={MODE_LABEL.rookie}
          badge="Ratings on"
          copy="Every rating on screen. Learn what the model rewards."
          note={ranked ? 'Does not reach the board.' : undefined}
          onPress={() => start('rookie', { ranked })}
        />
      </Reveal>

      {/* Under the modes, not above them. Ranked is what happens now, so this
          is a preference rather than a gate -- and a gate is what it was while
          it sat between somebody and the button they came to press. */}
      {isBackendConfigured ? (
        <Reveal delay={160}>
          <RankedSwitch
            on={ranked}
            busy={opening}
            onToggle={() => {
              setRanked((was: boolean) => !was);
              Haptics.selectionAsync().catch(() => {});
            }}
          />
        </Reveal>
      ) : null}

    </View>
  );

  // The three beats, with a heading of their own. They used to sit at the very
  // bottom of a phone, under five panels of somebody's personal statistics --
  // which is the wrong order for the one reader who has never played: the
  // explanation of the loop arrived after the scoreboard of a loop they had not
  // run. The prose blurb that used to say the same thing up in the hero is gone
  // into the note below, because saying it twice on one screen made the hero
  // longer and neither copy more convincing. The counts it sat with are on the
  // billboard's rail now.
  const loop = (
    <>
      <Reveal delay={150}>
        <SectionHead
          label="The loop"
          note="No simulation, and no luck after the whistle. Seven picks decide the season."
        />
      </Reveal>
      <Reveal delay={170} style={[styles.steps, layout.wide && styles.stepsWide]}>
        <Step
          index="01"
          title="Spin"
          copy="One franchise, one era. You do not choose it and you cannot reroll it."
        />
        <Step
          index="02"
          title="Take one"
          copy="Exactly one player from that spin. The rest of that roster is gone forever."
        />
        <Step
          index="03"
          title="Live with it"
          copy="Seven picks, then a rating and a record. Same roster, same season, every time."
        />
      </Reveal>
    </>
  );

  const aside = (
    <View style={styles.aside}>
      <Reveal delay={175}>
        <SectionHead label="Your seasons" />
      </Reveal>

      <Reveal delay={180} style={styles.statRow}>
        <Stat label="Games" value={String(stats.played)} />
        {/* The rating wears its own tier's colour, so the number and the badge
            it would earn on a card are never two different claims. */}
        <Stat
          label="Best rating"
          value={stats.bestRating ? stats.bestRating.toFixed(1) : '—'}
          tint={stats.bestRating ? tierColor[tierOf(stats.bestRating)] : undefined}
        />
        <Stat
          label="Best record"
          value={stats.bestRecord ? `${stats.bestRecord.wins}-${stats.bestRecord.losses}` : '—'}
          tint={
            stats.bestRecord?.losses === 0 && stats.bestRecord.wins > 0
              ? color.gold
              : stats.bestRecord
                ? color.ice
                : undefined
          }
        />
      </Reveal>

      <Reveal delay={220}>
        <Panel tint={stats.perfectSeasons > 0 ? color.gold : undefined} contentStyle={styles.chase}>
        <View style={styles.chaseHead}>
          <Crown size={20} tint={stats.perfectSeasons > 0 ? color.gold : color.textFaint} bright={stats.perfectSeasons > 0 ? color.goldBright : color.textFaint} />
          <Text style={styles.chaseTitle}>The chase</Text>
        </View>
        <View style={styles.chaseRow}>
          <View>
            {/* A zero stays grey. Colour here is the reward for the thing
                having happened at all. */}
            <Text style={[styles.chaseValue, stats.perfectSeasons > 0 && { color: color.goldBright }]}>
              {stats.perfectSeasons}
            </Text>
            <Text style={styles.chaseLabel}>18-0 seasons</Text>
          </View>
          <View>
            <Text style={[styles.chaseValue, stats.heartbreaks > 0 && { color: color.ice }]}>
              {stats.heartbreaks}
            </Text>
            <Text style={styles.chaseLabel}>17-1 seasons</Text>
          </View>
          <View>
            <Text style={[styles.chaseValue, stats.playerIqGames > 0 && { color: color.actionBright }]}>
              {stats.playerIqGames}
            </Text>
            <Text style={styles.chaseLabel}>Built blind</Text>
          </View>
        </View>
        <Text style={styles.chaseNote}>
          18-0 lands about once every 6,000 games. 17-1 about once every 49.
        </Text>
        </Panel>
      </Reveal>

      <Reveal delay={260}>
        <LeaderboardStrip onPress={() => router.push('/(tabs)/leaderboard')} />
      </Reveal>

      <Reveal delay={280}>
        <GetTheApp />
      </Reveal>

      {/* After the phones, because it is the least likely thing a first-time
          reader came for -- and before the closer, because it is still a way in
          rather than fine print. */}
      <Reveal delay={300}>
        <OnWatch />
      </Reveal>

    </View>
  );

  /**
   * The end of the build, and the second door.
   *
   * A page that opens on a lit billboard and closes on a paragraph of fine
   * print has told somebody the whole story and then left them at the bottom of
   * a phone with nothing to press. This is the same call the hero card makes --
   * Scout, honouring the ranked switch, through the same hook -- put where the
   * argument finishes. It is *below* everything, so it costs the fold nothing;
   * the primary way in is still the first card on the screen.
   */
  const closer = (
    <Reveal delay={320} style={styles.closer}>
      <View style={styles.closerText}>
        <Text style={styles.closerLine}>Seven spins. One roster.</Text>
        <Text style={styles.closerLineGold}>One shot at 18-0.</Text>
      </View>
      <Pressable
        onPress={() => start('scout', { ranked })}
        disabled={opening}
        accessibilityRole="button"
        accessibilityLabel={`Start a season in ${MODE_LABEL.scout}`}
        style={({ pressed, hovered }: PressState) => [
          styles.closerGo,
          hovered && styles.closerGoHover,
          (pressed || opening) && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.closerGoLabel}>Start a season</Text>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Path
            d="M5 12h13 M13 6l6 6-6 6"
            stroke={color.onAction}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
    </Reveal>
  );

  // Full width at the foot of the page rather than the last card in a sidebar,
  // which is where it ended up when it was part of the aside.
  const footer = (
    <Reveal delay={340} style={styles.footer}>
      <Text style={styles.footerLabel}>Bundled history</Text>
      <Text style={styles.footerValue}>Plays offline. Scores locally. Deterministic.</Text>
      <Text style={styles.footerNote}>
        Every rating is computed against its own era and stored on this device. No account, no
        connection required.
      </Text>
    </Reveal>
  );

  return (
    <Screen maxWidth={layout.wide ? layout.maxWidth : undefined}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {layout.wide ? null : (
          <View style={styles.header}>
            <Brand size={36} subtitle="Est. 2026" />
          </View>
        )}
        {/* A desktop window gets both halves side by side. Stacked, the landing
            was a phone-width column in the middle of a very large dark screen —
            which is the first thing anyone sees of this game. */}
        {layout.roomy ? (
          <>
            <View style={styles.split}>
              <View style={styles.splitMain}>{hero}</View>
              <View style={styles.splitSide}>{aside}</View>
            </View>
            <Reveal delay={110}>
              <Hall />
            </Reveal>
            {loop}
          </>
        ) : (
          <>
            {hero}
            <Reveal delay={110}>
              <Hall />
            </Reveal>
            {loop}
            {aside}
          </>
        )}

        {closer}
        {footer}
      </ScrollView>
    </Screen>
  );
}

/** The loop in three beats, for anyone who has not played it yet. */
function Step({ index, title, copy }: { index: string; title: string; copy: string }) {
  return (
    <View style={styles.step}>
      <Text style={styles.stepIndex}>{index}</Text>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepCopy}>{copy}</Text>
    </View>
  );
}

/**
 * One mode, as a single control.
 *
 * The old card put the name and its badge in one row, which overflowed the
 * card's own border the moment a name was long -- and it ended in a text link
 * that looked like a caption rather than the way into the game. Three modes
 * would have made both worse.
 *
 * So the badge sits above the name where nothing can push it out, the whole
 * row is the button, and the arrow is a filled disc: it reads as somewhere to
 * press from across a room, which is what the front page of a game needs.
 */
function ModeCard({
  name,
  badge,
  copy,
  hero,
  note,
  onPress,
}: {
  name: string;
  badge: string;
  copy: string;
  hero?: boolean;
  /** Shown when this mode will not do what the current settings imply. */
  note?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Play ${name}. ${copy}${note ? ` ${note}` : ''}`}
      style={({ pressed, hovered }: PressState) => [
        styles.mode,
        hero && styles.modeHero,
        hovered && (hero ? styles.modeHeroHover : { borderColor: color.lineBright }),
        pressed && { opacity: 0.88 },
      ]}
    >
      <View style={styles.modeBody}>
        <Text style={[styles.modeBadgeText, hero && styles.modeBadgeTextHero]}>{badge}</Text>
        <Text style={[styles.modeName, !hero && styles.modeNameQuiet]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.modeCopy} numberOfLines={2}>
          {copy}
        </Text>
        {note ? <Text style={styles.modeNote}>{note}</Text> : null}
      </View>
      <View style={[styles.modeGo, hero && styles.modeGoHero]}>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Path
            d="M5 12h13 M13 6l6 6-6 6"
            stroke={hero ? color.onAction : color.actionBright}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    </Pressable>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <Panel tint={tint} style={styles.stat} contentStyle={styles.statBody}>
      <View>
        <Text style={[styles.statValue, tint ? { color: tint } : null]}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </Panel>
  );
}

/** The tier a rating would earn, for colour only. */
function tierOf(rating: number): string {
  if (rating >= 99) return 'IMMORTAL';
  if (rating >= 96) return 'S+';
  if (rating >= 93) return 'S';
  if (rating >= 90) return 'A+';
  if (rating >= 86) return 'A';
  if (rating >= 82) return 'B+';
  return 'B';
}

const styles = themed(() => StyleSheet.create({
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: 140, gap: space.xxl },
  header: { paddingBottom: space.sm },
  split: { flexDirection: 'row', gap: space.xxl, alignItems: 'flex-start', width: '100%' },
  splitMain: { flex: 1.45, minWidth: 0 },
  splitSide: { flex: 1, minWidth: 0, maxWidth: 440 },


  steps: { gap: space.md },
  stepsWide: { flexDirection: 'row' },
  step: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: `${color.ink}99`,
  },
  // Big enough to be the beat rather than a caption on one. These are the only
  // numerals on the page below the billboard, and at thirteen points they read
  // as a footnote to the title underneath them.
  stepIndex: {
    fontFamily: font.display,
    fontSize: 30,
    lineHeight: 32,
    color: color.action,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
    ...tabular,
  },
  stepTitle: { fontFamily: font.heading, fontSize: 21, color: color.text, includeFontPadding: false },
  stepCopy: { fontFamily: font.bodyRegular, fontSize: 13, lineHeight: 19, color: color.textFaint },

  heroColumn: { gap: space.lg, width: '100%' },
  aside: { gap: space.lg, width: '100%' },

  headline: {
    fontFamily: font.display,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  /**
   * The third line is the only gold in the headline, and it is the line that
   * says "chase". Gold is not a hue in this app, it is the thing being chased,
   * so it goes on the sentence that names it and on the odds cell in the rail
   * that says how rarely it happens. It was silver, which read as the quiet
   * half of the sentence rather than the point of it.
   */
  headlineAccent: {
    color: color.goldBright,
    textShadowColor: color.goldGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },

  resume: {
    borderWidth: 1,
    borderColor: color.lineBright,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  resumeTrack: { height: 3, backgroundColor: '#FFFFFF0D' },
  resumeFill: { height: 3, backgroundColor: color.action },
  resumeBody: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  resumeMain: { flex: 1, minWidth: 0 },
  resumeTitle: { fontFamily: font.heading, fontSize: 19, color: color.text },
  resumeMeta: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim, marginTop: 1 },
  resumeGo: {
    backgroundColor: color.action,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  resumeGoLabel: {
    fontFamily: font.display,
    fontSize: 15,
    letterSpacing: tracking.wide,
    color: color.onAction,
    textTransform: 'uppercase',
  },
  discard: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  discardLabel: { fontFamily: font.body, fontSize: 13, color: color.textFaint },
  lift: { transform: [{ translateY: -1 }] },

  modes: { gap: space.sm },
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    backgroundColor: '#FFFFFF05',
  },
  modeHero: {
    borderColor: color.action,
    backgroundColor: `${color.action}14`,
    shadowColor: color.action,
    shadowOpacity: 0.3,
    ...elevate(7),
  },
  modeHeroHover: { shadowOpacity: 0.55, transform: [{ translateY: -2 }] },
  modeBody: { flex: 1, minWidth: 0, gap: 1 },
  /** The arrow is a target, not a decoration: 44 points, filled on the hero. */
  modeGo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: `${color.action}59`,
    backgroundColor: `${color.action}1F`,
  },
  modeGoHero: {
    borderColor: color.actionBright,
    backgroundColor: color.action,
    shadowColor: color.action,
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  modeName: {
    fontFamily: font.display,
    fontSize: 30,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  modeNameQuiet: { fontSize: 25, color: color.silver },
  modeBadgeText: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  modeBadgeTextHero: { color: color.actionBright },
  modeNote: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    color: color.gold,
  },
  modeCopy: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim, lineHeight: 19 },

  statRow: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1 },
  statBody: { paddingVertical: space.lg, alignItems: 'center' },
  statValue: {
    fontFamily: font.display,
    fontSize: 30,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  statLabel: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    textTransform: 'uppercase',
  },

  chase: { padding: space.lg, gap: space.md },
  chaseHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chaseTitle: {
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  chaseRow: { flexDirection: 'row', gap: space.xxl },
  chaseValue: {
    fontFamily: font.display,
    fontSize: 34,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  chaseLabel: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint },
  chaseNote: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint, lineHeight: 17 },

  closer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    padding: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.lineGold,
    backgroundColor: `${color.ink}CC`,
  },
  closerText: { flexShrink: 1, minWidth: 0 },
  closerLine: {
    fontFamily: font.display,
    fontSize: 28,
    lineHeight: 30,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  closerLineGold: {
    fontFamily: font.display,
    fontSize: 28,
    lineHeight: 30,
    color: color.goldBright,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  closerGo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: color.action,
    shadowColor: color.action,
    shadowOpacity: 0.5,
    ...elevate(8),
  },
  closerGoHover: { shadowOpacity: 0.8, transform: [{ translateY: -2 }] },
  closerGoLabel: {
    fontFamily: font.display,
    fontSize: 17,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.onAction,
  },

  footer: { gap: 4, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.lg },
  footerLabel: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  footerValue: { fontFamily: font.body, fontSize: 13, color: color.textDim },
  footerNote: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint, lineHeight: 17 },
}));
