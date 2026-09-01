import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Reveal } from '@/components/Reveal';
import { ROSTER_SLOTS } from '@18-0/domain';
import { DATASET } from '@18-0/data';
import { Brand } from '@/components/Brand';
import { Crown } from '@/components/Crown';
import { Screen } from '@/components/Screen';
import { LeaderboardStrip } from '@/components/LeaderboardStrip';
import { track } from '@/features/telemetry';
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

export default function Home() {
  const router = useRouter();
  const layout = useLayout();
  const game = useGameStore();
  const games = useHistoryStore((s) => s.games);
  const stats = useMemo(() => computeStats(games), [games]);

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

  const start = (mode: GameMode) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    track('play_started', { mode, replacing: inProgress });
    game.startGame(mode);
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
        <Text style={styles.kicker}>The NFL history roster game</Text>
        <Text style={[styles.headline, { fontSize: display, lineHeight: display * 0.98 }]}>
          Spin history.{'\n'}Build seven.{'\n'}
          <Text style={styles.headlineAccent}>Chase perfection.</Text>
        </Text>
        <Text style={[styles.blurb, layout.wide && styles.blurbWide]}>
          Every spin hands you one franchise and one era. Take a player, fill a slot, and live with
          it. Seven picks decide your season — no simulation, no luck after the whistle.
        </Text>
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
        <Text style={styles.footerValue}>
          {DATASET.coverage.firstSeason}–{DATASET.coverage.lastSeason} ·{' '}
          {DATASET.cards.length.toLocaleString()} rated seasons · {DATASET.combos.length}{' '}
          franchise-era combinations
        </Text>
        <Text style={styles.footerNote}>
          Every rating is computed against its own era and stored on this device. No account, no
          connection required.
        </Text>
      </Reveal>
    </View>
  );

  return (
    <Screen maxWidth={layout.wide ? 780 : undefined}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {layout.wide ? null : (
          <View style={styles.header}>
            <Brand size={36} subtitle="Est. 2026" />
          </View>
        )}
        {hero}
        {aside}
      </ScrollView>
    </Screen>
  );
}

function ModeCard({
  name,
  badge,
  copy,
  cta,
  hero,
  onPress,
}: {
  name: string;
  badge: string;
  copy: string;
  cta: string;
  hero?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${copy}`}
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
