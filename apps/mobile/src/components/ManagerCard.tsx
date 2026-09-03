import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { era as eraDef, franchise } from '@18-0/data';
import { Reveal } from './Reveal';
import { useCardTilt } from './useCardTilt';
import type { ProfileStats } from '@/state/history';
import type { Identity } from '@/services/supabase';
import type { SocialProvider } from '@/services/auth';
import { color, elevate, font, radius, space, tabular, tierColor, tracking } from '@/theme';

/**
 * The player's own card.
 *
 * The game asks people to collect seasons and gives them nothing of their own
 * to look at, so the account screen was a name, a button and a delete link. A
 * manager gets a card like the ones they spend the game collecting: the same
 * team-coloured wash, the same rail, the same big numerals.
 *
 * It takes the colours of the franchise they build with most, which makes the
 * card different for everyone who plays without anybody having to pick
 * anything.
 */
export function ManagerCard({
  identity,
  stats,
  providers,
  rank,
  sinceYear,
}: {
  identity: Identity | null;
  stats: ProfileStats;
  providers: readonly SocialProvider[];
  /** Their position on the all-time board, when they are on it. */
  rank?: number | null;
  /** Year of their first season. Null until they have played one. */
  sinceYear?: number | null;
}) {
  const team = stats.topFranchise ? franchise(stats.topFranchise) : null;
  const teamColor = team?.color || color.navy;
  const teamColor2 = team?.color2 || teamColor;
  const named = identity?.named === true;
  const tint = stats.bestRating ? tierColor[tierOf(stats.bestRating)] ?? color.gold : color.textFaint;

  // The only "member since" this game has: an anonymous account has no signup
  // a player would recognise as a start date, so the first season is the date.
  const since = sinceYear ?? null;

  // The same object the player cards are, so their own account reads as part of
  // the collection rather than a settings panel with a border.
  const { panHandlers, transform, sheenShift } = useCardTilt({ degrees: 5, sheenTravel: 200 });

  return (
    <Reveal distance={12} duration={320}>
      <Animated.View {...panHandlers} style={[styles.card, elevate(4), { transform }]}>
        {/* The franchise they build with most, washed across the card. */}
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
          <Defs>
            <LinearGradient id="mc-team" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={teamColor} stopOpacity="0.40" />
              <Stop offset="0.45" stopColor={teamColor2} stopOpacity="0.12" />
              <Stop offset="1" stopColor={teamColor} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#mc-team)" />
        </Svg>
        <View style={[styles.rail, { backgroundColor: teamColor }]} pointerEvents="none" />

        {/* Foil, matching the player cards. */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { transform: [{ translateX: sheenShift }] }]}
        >
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id="mc-foil" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.09" />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#mc-foil)" />
          </Svg>
        </Animated.View>

        <View style={styles.head}>
          <Text style={styles.eyebrow}>Manager</Text>
          <View style={styles.headRight}>
            {rank ? (
              <View style={[styles.chip, { borderColor: `${color.gold}66` }]}>
                <Text style={[styles.chipText, { color: color.gold }]}>#{rank} ALL TIME</Text>
              </View>
            ) : null}
            {providers.length > 0 ? (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{providers.map(label).join(' · ')}</Text>
              </View>
            ) : (
              <View style={[styles.chip, { borderStyle: 'dashed' }]}>
                <Text style={styles.chipText}>THIS DEVICE ONLY</Text>
              </View>
            )}
          </View>
        </View>

        <Text style={styles.handle} numberOfLines={1}>
          {named ? identity?.handle : 'Unnamed'}
        </Text>

        <View style={styles.headline}>
          <View>
            <Text style={styles.headlineLabel}>Best rating</Text>
            <Text style={[styles.rating, { color: tint }]}>
              {stats.bestRating === null ? '—' : stats.bestRating.toFixed(1)}
            </Text>
          </View>
          <View style={styles.headlineRight}>
            <Text style={styles.headlineLabel}>Best season</Text>
            <Text style={styles.record}>
              {stats.bestRecord ? `${stats.bestRecord.wins}-${stats.bestRecord.losses}` : '—'}
            </Text>
          </View>
        </View>

        <View style={styles.stats}>
          <Stat label="Seasons" value={stats.played} />
          <Stat label="Perfect" value={stats.perfectSeasons} tint={stats.perfectSeasons > 0 ? color.gold : undefined} />
          <Stat label="Heartbreak" value={stats.heartbreaks} />
          <Stat label="GM Mode" value={stats.playerIqGames} />
        </View>

        <View style={styles.foot}>
          <Text style={styles.footText} numberOfLines={1}>
            {team ? `Builds with ${team.name}` : 'No franchise yet'}
            {stats.topEra ? ` · ${eraDef(stats.topEra as never)?.label ?? stats.topEra}` : ''}
          </Text>
          {since ? <Text style={styles.footEst}>EST. {since}</Text> : null}
        </View>
      </Animated.View>
    </Reveal>
  );
}

function Stat({ label, value, tint }: { label: string; value: number; tint?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const label = (p: SocialProvider) => (p === 'apple' ? 'APPLE' : 'GOOGLE');

/** The tier letter a rating would earn, for colour only. */
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
  card: {
    // Dragging a card on the web selected its text instead of turning it.
    userSelect: 'none',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#0A0E17',
    overflow: 'hidden',
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
    paddingLeft: space.lg + 4,
    gap: space.sm,
  },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },

  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 },
  eyebrow: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  chip: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  chipText: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: color.textDim,
  },

  handle: {
    fontFamily: font.displayBlack,
    fontSize: 30,
    lineHeight: 34,
    color: color.text,
    includeFontPadding: false,
  },

  headline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.md,
    paddingTop: space.xs,
  },
  headlineRight: { alignItems: 'flex-end' },
  headlineLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
    marginBottom: 2,
  },
  rating: { fontFamily: font.display, fontSize: 44, includeFontPadding: false, ...tabular },
  record: {
    fontFamily: font.display,
    fontSize: 26,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },

  stats: {
    flexDirection: 'row',
    gap: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.line,
    marginTop: space.xs,
  },
  stat: { flex: 1, gap: 1 },
  statValue: {
    fontFamily: font.display,
    fontSize: 20,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  statLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textFaint,
  },

  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingTop: space.xs,
  },
  footText: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, flexShrink: 1 },
  footEst: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
    color: color.textFaint,
  },
});
