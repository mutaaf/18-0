import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Reveal } from '@/components/Reveal';
import { ROSTER_SLOTS } from '@18-0/domain';
import { DATASET } from '@18-0/data';
import { Brand } from '@/components/Brand';
import { Crown } from '@/components/Crown';
import { Hall } from '@/components/Hall';
import { Screen } from '@/components/Screen';
import { LeaderboardStrip } from '@/components/LeaderboardStrip';
import { track } from '@/features/telemetry';
import { beginRanked } from '@/features/ranked';
import { isBackendConfigured } from '@/services/supabase';
import { useGameStore, type GameMode } from '@/state/game';
import { computeStats, useHistoryStore } from '@/state/history';
import {
  color,
  elevate,
  font,
  radius,
  space,
  tabular,
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

  useEffect(() => {
    track('app_opened', { games: games.length });
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
        const opened = await withTimeout(beginRanked(mode === 'player_iq'), 8000);
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

  const resume = () => {
    track('game_resumed', { filled: game.selections.length, mode: game.mode });
    router.push('/play');
  };

  const discard = () => {
    track('game_abandoned', { filled: game.selections.length });
    game.abandon();
  };

  const display = layout.roomy ? 78 : layout.wide ? 62 : 44;

  const hero = (
    <View style={styles.heroColumn}>
      <Reveal delay={0}>
        <Text style={styles.kicker}>The pro football history game</Text>
        <Text style={[styles.headline, { fontSize: display, lineHeight: display * 0.98 }]}>
          Spin history.{'\n'}Build seven.{'\n'}
          <Text style={styles.headlineAccent}>Chase perfection.</Text>
        </Text>
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
                {game.mode === 'player_iq' ? 'Player IQ' : 'Rookie'}
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
          <Pressable
            onPress={() => {
              setRanked((on: boolean) => !on);
              Haptics.selectionAsync().catch(() => {});
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: ranked }}
            accessibilityLabel="Play for the leaderboard"
            style={({ hovered }: PressState) => [
              styles.ranked,
              hovered && { borderColor: color.lineBright },
              ranked && styles.rankedOn,
            ]}
          >
            <View style={[styles.rankedTick, ranked && styles.rankedTickOn]}>
              {ranked ? <Text style={styles.rankedTickMark}>✓</Text> : null}
            </View>
            <View style={styles.rankedBody}>
              <Text style={[styles.rankedTitle, ranked && { color: color.text }]}>
                Play for the leaderboard
              </Text>
              <Text style={styles.rankedCopy}>
                {opening
                  ? 'Opening a ranked game…'
                  : ranked
                    ? 'The server deals every spin and scores the roster. Only Player IQ seasons rank, and only once you sign in.'
                    : 'Off — this season stays on your device.'}
              </Text>
            </View>
          </Pressable>
        </Reveal>
      ) : null}

      <Reveal delay={140} style={styles.modes}>
        <ModeCard
          name="Player IQ"
          badge="Blind"
          copy="No ratings. No stat lines. Just a name, a team and a year — pick on what you actually know about football."
          cta="Play blind"
          hero
          onPress={() => start('player_iq')}
        />
        <ModeCard
          name="Rookie"
          badge="Ratings on"
          copy="Every rating and stat line on screen. Good for learning what the model rewards before you go blind."
          cta="Play with ratings"
          note={ranked ? 'Rookie seasons do not reach the leaderboard.' : undefined}
          onPress={() => start('rookie')}
        />
      </Reveal>
    </View>
  );

  const aside = (
    <View style={styles.aside}>
      <Reveal delay={180} style={styles.statRow}>
        <Stat label="Games" value={String(stats.played)} />
        <Stat label="Best rating" value={stats.bestRating ? stats.bestRating.toFixed(1) : '—'} />
        <Stat
          label="Best record"
          value={stats.bestRecord ? `${stats.bestRecord.wins}-${stats.bestRecord.losses}` : '—'}
        />
      </Reveal>

      <Reveal delay={220} style={styles.chase}>
        <View style={styles.chaseHead}>
          <Crown size={20} tint={stats.perfectSeasons > 0 ? color.gold : color.textFaint} bright={stats.perfectSeasons > 0 ? color.goldBright : color.textFaint} />
          <Text style={styles.chaseTitle}>The chase</Text>
        </View>
        <View style={styles.chaseRow}>
          <View>
            <Text style={[styles.chaseValue, stats.perfectSeasons > 0 && { color: color.goldBright }]}>
              {stats.perfectSeasons}
            </Text>
            <Text style={styles.chaseLabel}>18-0 seasons</Text>
          </View>
          <View>
            <Text style={styles.chaseValue}>{stats.heartbreaks}</Text>
            <Text style={styles.chaseLabel}>17-1 seasons</Text>
          </View>
          <View>
            <Text style={styles.chaseValue}>{stats.playerIqGames}</Text>
            <Text style={styles.chaseLabel}>Built blind</Text>
          </View>
        </View>
        <Text style={styles.chaseNote}>
          18-0 lands about once every 6,000 games. 17-1 about once every 49.
        </Text>
      </Reveal>

      <Reveal delay={260}>
        <LeaderboardStrip onPress={() => router.push('/(tabs)/leaderboard')} />
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

function ModeCard({
  name,
  badge,
  copy,
  cta,
  hero,
  note,
  onPress,
}: {
  name: string;
  badge: string;
  copy: string;
  cta: string;
  hero?: boolean;
  /** Shown when this mode will not do what the current settings imply. */
  note?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${copy}${note ? ` ${note}` : ''}`}
      style={({ pressed, hovered }: PressState) => [
        styles.mode,
        hero && styles.modeHero,
        hovered && (hero ? styles.modeHeroHover : { borderColor: color.lineBright }),
        pressed && { opacity: 0.88 },
      ]}
    >
      <View style={styles.modeHead}>
        <Text style={[styles.modeName, !hero && styles.modeNameQuiet]}>{name}</Text>
        <View style={[styles.modeBadge, hero && styles.modeBadgeHero]}>
          <Text style={[styles.modeBadgeText, hero && styles.modeBadgeTextHero]}>{badge}</Text>
        </View>
      </View>
      <Text style={styles.modeCopy}>{copy}</Text>
      {note ? <Text style={styles.modeNote}>{note}</Text> : null}
      <Text style={[styles.modeGo, !hero && styles.modeGoQuiet]}>{cta} →</Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: 140, gap: space.xxl },
  header: { paddingBottom: space.sm },
  split: { flexDirection: 'row', gap: space.xxl, alignItems: 'flex-start', width: '100%' },
  splitMain: { flex: 1.45, minWidth: 0 },
  splitSide: { flex: 1, minWidth: 0, maxWidth: 440 },

  ranked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#0A0E1799',
  },
  rankedOn: { borderColor: `${color.gold}66`, backgroundColor: '#14110699' },
  rankedTick: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.lineBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankedTickOn: { backgroundColor: color.gold, borderColor: color.gold },
  rankedTickMark: { fontFamily: font.bodyBold, fontSize: 13, color: '#0A0E17' },
  rankedBody: { flex: 1, minWidth: 0, gap: 2 },
  rankedTitle: { fontFamily: font.heading, fontSize: 17, color: color.textDim },
  rankedCopy: { fontFamily: font.bodyRegular, fontSize: 12, lineHeight: 17, color: color.textFaint },

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

  modes: { gap: space.md },
  mode: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space.xl,
    gap: space.sm,
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
  modeHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  modeName: {
    fontFamily: font.display,
    fontSize: 30,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  modeNameQuiet: { fontSize: 25, color: color.silver },
  modeBadge: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 2,
  },
  modeBadgeHero: { borderColor: '#FF2B2B99' },
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
  modeCopy: { fontFamily: font.bodyRegular, fontSize: 14, color: color.textDim, lineHeight: 21 },
  modeGo: {
    fontFamily: font.label,
    fontSize: 14,
    letterSpacing: tracking.wide,
    color: color.redBright,
  },
  modeGoQuiet: { color: color.textFaint },

  statRow: { flexDirection: 'row', gap: space.sm },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    backgroundColor: '#FFFFFF05',
  },
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

  chase: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
    backgroundColor: '#FFFFFF04',
  },
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
