import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { RankedSwitch } from '@/components/RankedSwitch';
import Svg, { Path } from 'react-native-svg';
import { Reveal } from '@/components/Reveal';
import { ROSTER_SLOTS } from '@18-0/domain';
import { DATASET, gamedayAt, type Gameday } from '@18-0/data';
import { Brand } from '@/components/Brand';
import { GamedayHero } from '@/components/GamedayHero';
import { Crown } from '@/components/Crown';
import { Hall } from '@/components/Hall';
import { Screen } from '@/components/Screen';
import { GetTheApp } from '@/components/GetTheApp';
import { LeaderboardStrip } from '@/components/LeaderboardStrip';
import { Panel } from '@/components/Panel';
import { track } from '@/features/telemetry';
import { beginRanked } from '@/features/ranked';
import { flag } from '@/features/flags';
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
  tierColor,
  tracking,
  useLayout,
  type PressState,
} from '@/theme';

/** Resolves to null rather than hanging, so a stalled request cannot trap a screen. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default function Home() {
  const router = useRouter();
  const layout = useLayout();
  const game = useGameStore();
  const games = useHistoryStore((s) => s.games);
  const stats = useMemo(() => computeStats(games), [games]);
  /**
   * Off by default, and deliberately.
   *
   * A ranked game is played against the server, so it needs a connection and it
   * is slower by a round trip per spin. The offline game is the product; the
   * leaderboard is the reason to go online, not a tax on everyone who does not
   * care about it.
   */
  const [ranked, setRanked] = useState(false);
  const [opening, setOpening] = useState(false);
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

  const start = async (mode: GameMode) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    track('play_started', { mode, replacing: inProgress, ranked });
    game.startGame(mode, { ranked });

    // The session is opened before the first spin, so a player learns that
    // ranked is unavailable now rather than seven picks from now.
    //
    // Wrapped, timed out, and unconditionally followed by the navigation. This
    // used to be a bare `await` before `router.push`, so anything that threw or
    // hung left the Play button doing nothing at all — which is exactly what
    // happened on device, where `crypto.randomUUID` does not exist. Failing to
    // open a ranked game must cost the leaderboard, never the game.
    if (ranked) {
      setOpening(true);
      try {
        const opened = await withTimeout(beginRanked(mode), 8000);
        if (opened?.ok) {
          game.attachServerSession(opened.value.sessionId, opened.value.idempotencyKey);
          track('ranked_started', { mode });
        } else {
          const reason = opened?.message ?? 'The server did not answer in time.';
          game.downgrade(reason);
          track('ranked_downgraded', { reason });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Ranked play could not start.';
        game.downgrade(reason);
        track('ranked_downgraded', { reason });
      } finally {
        setOpening(false);
      }
    }
    router.push('/play');
  };

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
      setOpening(true);
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
        setOpening(false);
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

  const display = layout.roomy ? 78 : layout.wide ? 62 : 38;

  const hero = (
    <View style={styles.heroColumn}>
      <Reveal delay={0}>
        <Text style={styles.kicker}>The pro football history game</Text>
        <Text style={[styles.headline, { fontSize: display, lineHeight: display * 0.98 }]}>
          Spin history.{'\n'}Build seven.{'\n'}
          <Text style={styles.headlineAccent}>Chase perfection.</Text>
        </Text>
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

      {isBackendConfigured ? (
        <Reveal delay={120}>
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

      <Reveal delay={140} style={styles.modes}>
        <ModeCard
          name={MODE_LABEL.player_iq}
          badge="Blind"
          copy="A name, a team, a year. Pick on what you know."
          hero
          onPress={() => start('player_iq')}
        />
        <ModeCard
          name={MODE_LABEL.scout}
          badge="Stats only"
          copy="The stat line, no rating. Read the numbers and judge."
          onPress={() => start('scout')}
        />
        <ModeCard
          name={MODE_LABEL.rookie}
          badge="Ratings on"
          copy="Every rating on screen. Learn what the model rewards."
          note={ranked ? 'Does not reach the board.' : undefined}
          onPress={() => start('rookie')}
        />
      </Reveal>

      {/* Below the choice on purpose. This is the part somebody reads once,
          and it was pushing the two buttons they came for off a phone screen. */}
      <Reveal delay={200}>
        <Text style={[styles.blurb, layout.wide && styles.blurbWide]}>
          Every spin hands you one franchise and one era. Take a player, fill a slot, and live with
          it. Seven picks decide your season — no simulation, no luck after the whistle.
        </Text>
        <View style={styles.proof}>
          <Text style={styles.proofValue}>
            {DATASET.cards.length.toLocaleString()}
            <Text style={styles.proofLabel}> rated seasons</Text>
          </Text>
          <View style={styles.proofDot} />
          <Text style={styles.proofValue}>
            {DATASET.combos.length}
            <Text style={styles.proofLabel}> franchise-eras</Text>
          </Text>
          <View style={styles.proofDot} />
          <Text style={styles.proofValue}>
            {DATASET.coverage.firstSeason}–{DATASET.coverage.lastSeason}
          </Text>
        </View>
      </Reveal>
    </View>
  );

  const aside = (
    <View style={styles.aside}>
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
            <Text style={[styles.chaseValue, stats.playerIqGames > 0 && { color: color.redBright }]}>
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

      <Reveal delay={300} style={styles.footer}>
        <Text style={styles.footerLabel}>Bundled history</Text>
        <Text style={styles.footerValue}>Plays offline. Scores locally. Deterministic.</Text>
        <Text style={styles.footerNote}>
          Every rating is computed against its own era and stored on this device. No account, no
          connection required.
        </Text>
      </Reveal>
    </View>
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
          </>
        ) : (
          <>
            {hero}
            <Reveal delay={110}>
              <Hall />
            </Reveal>
            {aside}
          </>
        )}

        <Reveal delay={160} style={[styles.steps, layout.wide && styles.stepsWide]}>
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
            stroke={hero ? '#FFFFFF' : color.redBright}
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

const styles = StyleSheet.create({
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
    backgroundColor: '#0A0E1799',
  },
  stepIndex: {
    fontFamily: font.display,
    fontSize: 13,
    color: color.red,
    letterSpacing: tracking.wide,
    ...tabular,
  },
  stepTitle: { fontFamily: font.heading, fontSize: 21, color: color.text, includeFontPadding: false },
  stepCopy: { fontFamily: font.bodyRegular, fontSize: 13, lineHeight: 19, color: color.textFaint },

  proof: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  proofValue: { fontFamily: font.bodyBold, fontSize: 13, color: color.silver, ...tabular },
  proofLabel: { fontFamily: font.bodyRegular, color: color.textFaint },
  proofDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: color.line },

  heroColumn: { gap: space.xl, width: '100%' },
  aside: { gap: space.lg, width: '100%' },

  kicker: {
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: tracking.wider,
    color: color.redBright,
    textTransform: 'uppercase',
    marginBottom: space.sm,
  },
  headline: {
    fontFamily: font.display,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  headlineAccent: { color: color.silver },
  blurb: {
    fontFamily: font.bodyRegular,
    fontSize: 15,
    lineHeight: 23,
    color: color.textDim,
    marginTop: space.md,
    maxWidth: 460,
  },
  blurbWide: { fontSize: 16, lineHeight: 25 },

  resume: {
    borderWidth: 1,
    borderColor: color.lineBright,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  resumeTrack: { height: 3, backgroundColor: '#FFFFFF0D' },
  resumeFill: { height: 3, backgroundColor: color.red },
  resumeBody: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  resumeMain: { flex: 1, minWidth: 0 },
  resumeTitle: { fontFamily: font.heading, fontSize: 19, color: color.text },
  resumeMeta: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim, marginTop: 1 },
  resumeGo: {
    backgroundColor: color.red,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  resumeGoLabel: {
    fontFamily: font.display,
    fontSize: 15,
    letterSpacing: tracking.wide,
    color: '#fff',
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
    borderColor: color.red,
    backgroundColor: '#D50A0A14',
    shadowColor: color.red,
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
    borderColor: `${color.red}59`,
    backgroundColor: `${color.red}1F`,
  },
  modeGoHero: {
    borderColor: color.redBright,
    backgroundColor: color.red,
    shadowColor: color.red,
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
  modeBadgeTextHero: { color: color.redBright },
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
});
