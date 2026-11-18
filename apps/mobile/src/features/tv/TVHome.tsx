import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { ROSTER_SLOTS } from '@17-0/domain';
import { DATASET, type Gameday } from '@17-0/data';
import { Crown } from '@/components/Crown';
import { DockIcon, type DockIconName } from '@/components/DockIcons';
import { Pressable } from '@/components/Pressable';
import { Reveal } from '@/components/Reveal';
import { useFlag } from '@/features/flags';
import { MODE_LABEL, type GameMode } from '@/state/game';
import { DECORATIVE, color, font, radius, space, tabular, themed, tracking, type PressState } from '@/theme';

/**
 * The front page, ten feet away.
 *
 * The phone's front page is a long scroll: a billboard, a story, the modes,
 * the loop, the stats -- the right order for a thumb, and on a TV it ran off
 * the bottom of the glass with "02" cut in half. A TV home is a different
 * object (the TV app, Arcade): one hero with the primary action in it, then
 * shelves of large tiles, and everything that matters above the fold.
 *
 * So: the hero carries the headline, the one-click Play (or Resume, when a
 * season is open) and the ranked switch; the first shelf is the three lenses
 * as big tiles; the second is everything else there is to do. The decisions
 * themselves -- what Play starts, what ranked means, what Resume and Discard
 * do -- are the phone's, passed in from `app/(tabs)/index.tsx`, so the two
 * front pages can never disagree about the game.
 */
export interface TVHomeProps {
  inProgress: boolean;
  filled: number;
  mode: GameMode;
  quickMode: GameMode;
  quickKind: string;
  ranked: boolean;
  rankedOffered: boolean;
  opening: boolean;
  stats: { played: number; bestRating: number | null; perfectSeasons: number; bestRecord: { wins: number; losses: number } | null };
  gameday: Gameday | null;
  onStart: (mode: GameMode) => void;
  onResume: () => void;
  onDiscard: () => void;
  onToggleRanked: () => void;
  onGameday: (day: Gameday) => void;
}

const LENSES: { mode: GameMode; badge: string; copy: string; glyph: string }[] = [
  { mode: 'scout', badge: 'Stats only', copy: 'The stat line, no rating. Read the numbers and judge.', glyph: 'M4 18V9 M10 18V5 M16 18v-7 M22 18H2' },
  { mode: 'player_iq', badge: 'Blind', copy: 'No stat line either. Just a name, a team and a year.', glyph: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M4 4l16 16' },
  { mode: 'rookie', badge: 'Ratings on', copy: 'Every rating on screen. Learn what the model rewards.', glyph: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' },
];

export function TVHome(props: TVHomeProps) {
  const router = useRouter();
  const gutCheck = useFlag('gut_check');
  const { inProgress, ranked, opening, stats } = props;

  return (
    // The scroll view clips, and a focused tile grows past its own edges: the
    // page is pulled out by the room a lift needs and padded back in, so the
    // layout is where it was and the first tile in a row is not cut off.
    <ScrollView style={styles.scroller} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      {/* Not in a Reveal: it starts at opacity 0, and UIKit will not hand
          preferred focus to a view it cannot see -- the remote landed on the
          rail instead of Play. The shelves below still deal in. */}
      <View>
        <View style={styles.hero}>
          <HeroPaint />
          <View style={styles.heroMain}>
            <View style={styles.kickerRow}>
              <View style={styles.liveDot} />
              <Text style={styles.kicker}>The pro football history game</Text>
            </View>
            <Text style={styles.headline}>
              Spin history. Build seven.{'\n'}
              <Text style={styles.headlineGold}>Chase perfection.</Text>
            </Text>

            <View style={styles.heroActions}>
              {inProgress ? (
                <>
                  <Pressable
                    onPress={props.onResume}
                    hasTVPreferredFocus
                    accessibilityRole="button"
                    accessibilityLabel={`Resume game, ${props.filled} of seven filled`}
                    style={styles.primary}
                  >
                    <PlayGlyph />
                    <View>
                      <Text style={styles.primaryLabel}>Resume</Text>
                      <Text style={styles.primarySub}>
                        {props.filled} of {ROSTER_SLOTS.length} · {MODE_LABEL[props.mode]}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable onPress={props.onDiscard} accessibilityRole="button" accessibilityLabel="Discard the game in progress" style={styles.secondary}>
                    <Text style={styles.secondaryLabel}>Discard</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  onPress={() => props.onStart(props.quickMode)}
                  disabled={opening}
                  hasTVPreferredFocus
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${MODE_LABEL[props.quickMode]}, ${props.quickKind.toLowerCase()}`}
                  style={[styles.primary, opening && { opacity: 0.8 }]}
                >
                  <PlayGlyph />
                  <View>
                    <Text style={styles.primaryLabel}>Play {MODE_LABEL[props.quickMode]}</Text>
                    <Text style={styles.primarySub}>{props.quickKind} · the wheel spins right away</Text>
                  </View>
                </Pressable>
              )}
              {props.rankedOffered ? (
                <Pressable
                  onPress={props.onToggleRanked}
                  disabled={opening}
                  role="switch"
                  aria-checked={ranked}
                  aria-label="Play for the leaderboard"
                  style={[styles.secondary, ranked && styles.rankedOn]}
                >
                  <View style={[styles.switchTrack, ranked && styles.switchTrackOn]}>
                    <View style={[styles.switchKnob, ranked && styles.switchKnobOn]} />
                  </View>
                  <Text style={[styles.secondaryLabel, ranked && { color: color.goldBright }]}>
                    {ranked ? 'Ranked' : 'Casual'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.heroStats} {...DECORATIVE}>
            <HeroStat value={DATASET.cards.length.toLocaleString()} label="Rated seasons" />
            <HeroStat value={String(DATASET.combos.length)} label="Franchise-eras" />
            <HeroStat value="1 in 6,000" label="Odds of 17-0" gold />
          </View>
        </View>
      </View>

      <Reveal delay={90}>
        <Text style={styles.shelfTitle}>Pick your lens</Text>
      </Reveal>
      <View style={styles.shelf}>
        {LENSES.map((lens, i) => (
          <Reveal key={lens.mode} delay={120 + i * 60} distance={24} style={styles.tileSeat}>
            <Pressable
              onPress={() => props.onStart(lens.mode)}
              disabled={opening}
              accessibilityRole="button"
              accessibilityLabel={`Play ${MODE_LABEL[lens.mode]}. ${lens.copy}`}
              style={styles.lens}
            >
              {({ focused }: PressState) => (
                <>
                  <TilePaint lit={Boolean(focused)} />
                  <View style={styles.lensTop}>
                    <Text style={[styles.lensBadge, focused && { color: color.text }]}>{lens.badge}</Text>
                    <Svg width={30} height={30} viewBox="0 0 24 24" fill="none" {...DECORATIVE}>
                      <Path d={lens.glyph} stroke={focused ? color.text : color.actionBright} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </View>
                  <Text style={styles.lensName}>{MODE_LABEL[lens.mode]}</Text>
                  <Text style={styles.lensCopy} numberOfLines={2}>
                    {lens.copy}
                  </Text>
                  {lens.mode === 'rookie' && ranked ? <Text style={styles.lensNote}>Does not reach the board</Text> : null}
                </>
              )}
            </Pressable>
          </Reveal>
        ))}
      </View>

      <Reveal delay={300}>
        <Text style={styles.shelfTitle}>More to play</Text>
      </Reveal>
      <View style={styles.shelf}>
        {props.gameday ? (
          <ShelfTile
            icon="index"
            title="Gameday"
            sub="Today's board, today's teams"
            onPress={() => props.gameday && props.onGameday(props.gameday)}
            delay={330}
          />
        ) : null}
        {gutCheck ? (
          <ShelfTile icon="games" title="Gut Check" sub="Fair or off? Ten ratings" onPress={() => router.push('/rate')} delay={350} />
        ) : null}
        <ShelfTile icon="leaderboard" title="Leaderboards" sub="Who is closest to 17-0" onPress={() => router.push('/(tabs)/leaderboard')} delay={370} />
        <ShelfTile
          icon="stats"
          title="Your seasons"
          sub={
            stats.played
              ? `${stats.played} played · best ${stats.bestRecord ? `${stats.bestRecord.wins}-${stats.bestRecord.losses}` : '—'}`
              : 'Nothing played yet'
          }
          onPress={() => router.push('/(tabs)/stats')}
          delay={390}
          crown={stats.perfectSeasons > 0}
        />
      </View>
    </ScrollView>
  );
}

function PlayGlyph() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" {...DECORATIVE}>
      <Path d="M7 4.5v15l12.5-7.5z" fill={color.onAction} />
    </Svg>
  );
}

function HeroStat({ value, label, gold }: { value: string; label: string; gold?: boolean }) {
  return (
    <View style={styles.heroStat}>
      <Text style={[styles.heroStatValue, gold && { color: color.goldBright }]}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

function ShelfTile({
  icon,
  title,
  sub,
  onPress,
  delay,
  crown,
}: {
  icon: DockIconName;
  title: string;
  sub: string;
  onPress: () => void;
  delay: number;
  crown?: boolean;
}) {
  return (
    <Reveal delay={delay} distance={24} style={styles.tileSeat}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`} style={styles.small}>
        {({ focused }: PressState) => (
          <>
            <TilePaint lit={Boolean(focused)} />
            <DockIcon name={icon} size={40} />
            <View style={styles.smallText}>
              <View style={styles.smallTitleRow}>
                <Text style={styles.smallTitle} numberOfLines={1}>
                  {title}
                </Text>
                {crown ? <Crown size={16} tint={color.gold} bright={color.goldBright} /> : null}
              </View>
              <Text style={styles.smallSub} numberOfLines={1}>
                {sub}
              </Text>
            </View>
          </>
        )}
      </Pressable>
    </Reveal>
  );
}

/** The hero's light: the action colour bleeding in from the left, a floor of navy. */
function HeroPaint() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" {...DECORATIVE}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="tvHeroWash" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={color.panelTop} stopOpacity="1" />
            <Stop offset="0.6" stopColor={color.surface} stopOpacity="0.92" />
            <Stop offset="1" stopColor={color.void} stopOpacity="0.85" />
          </LinearGradient>
          <RadialGradient id="tvHeroGlow" cx="8%" cy="0%" r="70%">
            <Stop offset="0" stopColor={color.action} stopOpacity="0.32" />
            <Stop offset="1" stopColor={color.action} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="tvHeroGold" cx="100%" cy="100%" r="55%">
            <Stop offset="0" stopColor={color.gold} stopOpacity="0.16" />
            <Stop offset="1" stopColor={color.gold} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tvHeroWash)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tvHeroGlow)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tvHeroGold)" />
      </Svg>
    </View>
  );
}

/** A tile's face: glass at rest, lit from above when the remote is on it. */
function TilePaint({ lit }: { lit: boolean }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" {...DECORATIVE}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={lit ? 'tvTileLit' : 'tvTile'} x1="0" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor={lit ? color.lineBright : color.panelTop} stopOpacity="1" />
            <Stop offset="1" stopColor={lit ? color.surfaceRaised : color.surface} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${lit ? 'tvTileLit' : 'tvTile'})`} />
      </Svg>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    scroller: { marginHorizontal: -space.xl, marginTop: -space.sm },
    page: { paddingTop: space.lg + space.sm, paddingBottom: space.xxl, paddingLeft: space.xl, paddingRight: space.xl + space.lg, gap: space.md },

    hero: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: color.lineBright,
      overflow: 'hidden',
      paddingHorizontal: space.xxl,
      paddingVertical: space.xl,
      gap: space.xxl,
    },
    heroMain: { flex: 1, minWidth: 0, gap: space.md },
    kickerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.action },
    kicker: { fontFamily: font.label, fontSize: 14, letterSpacing: tracking.wider, textTransform: 'uppercase', color: color.silver },
    headline: { fontFamily: font.display, fontSize: 46, lineHeight: 46, color: color.text },
    headlineGold: { color: color.goldBright },
    heroActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.sm },
    primary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      backgroundColor: color.action,
      borderRadius: radius.lg,
      paddingHorizontal: space.xl,
      paddingVertical: space.md,
      minWidth: 280,
    },
    primaryLabel: { fontFamily: font.display, fontSize: 24, letterSpacing: tracking.normal, color: color.onAction },
    primarySub: { fontFamily: font.body, fontSize: 12, color: color.onAction, opacity: 0.8 },
    secondary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.lineBright,
      backgroundColor: color.scrim,
      paddingHorizontal: space.lg,
      height: 58,
    },
    rankedOn: { borderColor: color.lineGold },
    secondaryLabel: { fontFamily: font.heading, fontSize: 18, color: color.silver },
    switchTrack: { width: 40, height: 22, borderRadius: 11, backgroundColor: color.line, padding: 3 },
    switchTrackOn: { backgroundColor: color.goldDeep },
    switchKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: color.silver },
    switchKnobOn: { backgroundColor: color.goldBright, transform: [{ translateX: 18 }] },

    heroStats: {
      width: 220,
      justifyContent: 'center',
      gap: space.md,
      borderLeftWidth: 1,
      borderLeftColor: color.line,
      paddingLeft: space.xl,
    },
    heroStat: { gap: 0 },
    heroStatValue: { fontFamily: font.display, fontSize: 30, lineHeight: 32, color: color.text, ...tabular },
    heroStatLabel: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, textTransform: 'uppercase', color: color.textDim },

    shelfTitle: { fontFamily: font.heading, fontSize: 20, color: color.text, marginTop: space.sm, marginLeft: space.xs },
    shelf: { flexDirection: 'row', gap: space.xl },
    tileSeat: { flex: 1 },
    lens: {
      height: 150,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: color.line,
      overflow: 'hidden',
      padding: space.lg,
      justifyContent: 'flex-end',
      gap: 2,
    },
    lensTop: { position: 'absolute', top: space.lg, left: space.lg, right: space.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    lensBadge: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide, textTransform: 'uppercase', color: color.actionBright },
    lensName: { fontFamily: font.display, fontSize: 34, lineHeight: 36, color: color.text },
    lensCopy: { fontFamily: font.body, fontSize: 12, lineHeight: 16, color: color.silver },
    lensNote: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.normal, color: color.gold },

    small: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      height: 76,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.line,
      overflow: 'hidden',
      paddingHorizontal: space.lg,
    },
    smallText: { flex: 1, minWidth: 0 },
    smallTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    smallTitle: { fontFamily: font.heading, fontSize: 19, color: color.text },
    smallSub: { fontFamily: font.body, fontSize: 11, color: color.silver },
  }),
);
