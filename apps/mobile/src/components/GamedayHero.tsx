import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import {
  franchise,
  gamedayAt,
  gamedayDate,
  gamedayLabel,
  nextGamedayAfter,
  type Gameday,
} from '@18-0/data';
import { useFlag } from '@/features/flags';
import { DECORATIVE, color, elevate, font, radius, space, tabular, tracking, type PressState } from '@/theme';

/**
 * The gameday slab.
 *
 * Every other mode is a control on a page. This one is a marquee, because it is
 * the only thing in the game that is *on* or *off*: while the league is playing
 * it lights up, restricts the wheel to the franchises actually on the field,
 * and puts everyone who plays it on one board that belongs to that day. The
 * rest of the week it is a dark stadium with a date on it.
 *
 * So the two states are drawn as two states of the same object rather than as
 * two components: floodlights up and a red LIVE beacon, or the lights down and
 * the next kickoff on the marquee. It re-checks the clock on its own, which
 * means the screen turns on when the league does without anybody reloading it.
 *
 * Motion is decorative and everything survives without it — the sweep, the
 * beacon and the shine all render static under Reduce Motion, and the content
 * never depends on an animation having completed.
 */

/** `2h 14m`, `48m`, `3 days`. Coarse on purpose: this is a marquee, not a bomb. */
function until(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return 'now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Three readings of the same offer, chosen by the `gameday_cta` experiment.
 *
 * The panel is the only thing in the game that has to convert against a
 * deadline, and there is no reason to believe the first wording anybody wrote
 * is the one that gets people through the turnstile. Written out side by side
 * on purpose: a variant hidden behind string concatenation three screens away
 * is a variant nobody can review before it ships to a third of the players.
 *
 * Only the words change. Same wheel, same visibility, same board, same
 * scoring -- see the invariant in `features/flags/registry.ts`.
 *
 * Read by `GamedayCall`, which renders only while a gameday is open. That is
 * deliberate; the comment on that component explains why.
 */
const CTA_COPY: Record<
  string,
  { readonly label: (day: Gameday) => string; readonly reason: (day: Gameday) => string }
> = {
  control: {
    label: () => 'Enter Gameday',
    reason: (day) =>
      `The wheel holds only the ${day.franchises.length} franchises on the field today. ` +
      'Stat lines on, ratings off, one board — and it belongs to this date.',
  },
  clock: {
    label: () => 'Play before the whistle',
    reason: () =>
      'The board settles when the last game does. Every season built today is ranked ' +
      'against every other season built today, and then it is finished.',
  },
  field: {
    label: (day) => `Take today's ${day.franchises.length} teams`,
    reason: (day) =>
      `Thirty-two franchises, and today you may only have these ${day.franchises.length}. ` +
      'The same seven slots, out of a much smaller history.',
  },
};

/** `Dallas at Philadelphia`, because a city is a place and a club is a mark. */
const fixture = (game: Gameday['games'][number]): string =>
  `${franchise(game.away).nick} at ${franchise(game.home).nick}`;

export interface GamedayHeroProps {
  /** How many seasons are on the board so far, when the server has said. */
  summary?: { players: number; seasons: number; bestRating: number | null } | null;
  /** True while a session is being opened, so the door does not open twice. */
  busy?: boolean;
  onEnter: (day: Gameday) => void;
  /** Why the last attempt to enter failed, if it did. */
  note?: string | null;
  /**
   * How far ahead the dark state is worth showing.
   *
   * In March the next gameday is six months away, and a marquee counting down
   * to it is not anticipation, it is clutter on the front page. Inside the
   * window it is the most interesting thing on the screen; outside it, the
   * panel removes itself.
   */
  horizonDays?: number;
}

export function GamedayHero({
  summary,
  busy = false,
  onEnter,
  note,
  horizonDays = 8,
}: GamedayHeroProps) {
  /**
   * The kill switch, read where it is used.
   *
   * Gameday is the newest thing in the game and the only mode whose
   * availability changes on its own -- a generated calendar, a trigger and a
   * board, all of it new. The alternative to being able to turn this off from
   * a web page on a Sunday afternoon is an App Store review.
   */
  const enabled = useFlag('gameday');

  // One clock for the whole slab. Thirty seconds is fine for a countdown
  // rendered in minutes, and it is what makes the panel light itself up when
  // the window opens rather than waiting for a navigation.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const live = useMemo(() => gamedayAt(new Date(now)), [now]);
  const next = useMemo(() => (live ? null : nextGamedayAfter(new Date(now))), [live, now]);
  const day = live ?? next;

  const [motion, setMotion] = useState(true);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => !cancelled && setMotion(!reduced))
      .catch(() => setMotion(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // The beacon and the shine: one loop each, started only when the panel is
  // live and motion is allowed.
  const beacon = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!live || !motion) {
      beacon.setValue(1);
      shine.setValue(0);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(beacon, { toValue: 1, duration: 620, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(beacon, { toValue: 0.25, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const sweep = Animated.loop(
      Animated.sequence([
        Animated.timing(shine, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.delay(2600),
      ]),
    );
    pulse.start();
    sweep.start();
    return () => {
      pulse.stop();
      sweep.stop();
    };
  }, [live, motion]);

  if (!enabled || !day) return null;
  if (!live && Date.parse(day.opensAt) - now > horizonDays * 86_400_000) return null;

  const closing = live ? until(live.closesAt, now) : null;
  const opening = next ? until(next.opensAt, now) : null;
  const shown = day.games.slice(0, 3);
  const hidden = day.games.length - shown.length;

  return (
    <View style={[styles.slab, live ? styles.slabLive : styles.slabDark, elevate(live ? 12 : 6)]}>
      <Floodlights live={Boolean(live)} />

      <View style={styles.head}>
        <View style={styles.beaconRow}>
          {live ? (
            <Animated.View style={[styles.beacon, { opacity: beacon }]} {...DECORATIVE} />
          ) : (
            <View style={[styles.beacon, styles.beaconOff]} {...DECORATIVE} />
          )}
          <Text style={[styles.kicker, live && styles.kickerLive]}>
            {live ? 'Gameday · live now' : 'Next gameday'}
          </Text>
        </View>
        {live ? (
          <Text style={styles.clock}>
            Closes in <Text style={styles.clockValue}>{closing}</Text>
          </Text>
        ) : (
          <Text style={styles.clock}>
            Opens in <Text style={styles.clockValue}>{opening}</Text>
          </Text>
        )}
      </View>

      <Text style={styles.title}>{gamedayDate(day)}</Text>
      <Text style={styles.round}>{gamedayLabel(day)}</Text>

      <View style={styles.fixtures}>
        {shown.map((game) => (
          <View key={`${game.away}-${game.home}`} style={styles.fixture}>
            <Text style={styles.fixtureText}>{fixture(game)}</Text>
          </View>
        ))}
        {hidden > 0 ? (
          <View style={[styles.fixture, styles.fixtureMore]}>
            <Text style={styles.fixtureText}>+{hidden} more</Text>
          </View>
        ) : null}
      </View>

      {live ? (
        <GamedayCall day={live} summary={summary} busy={busy} onEnter={onEnter} shine={shine} />
      ) : (
        <>
          <Text style={styles.copy}>
            {`When the lights come on, the wheel narrows to the ${day.franchises.length} franchises ` +
              'playing and everyone who plays lands on one board for the day.'}
          </Text>
          <View style={styles.closed}>
            <Text style={styles.closedLabel}>Doors open three hours before the first kickoff</Text>
          </View>
        </>
      )}

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

/**
 * The words on the door, and the door.
 *
 * A separate component for one reason, and it is a measurement reason rather
 * than a rendering one: reading a flag reports an exposure, and PostHog divides
 * by exposures. The parent renders on every visit to the home screen -- most of
 * them on a Tuesday, when the panel is a dark marquee with no call to action at
 * all -- so reading `gameday_cta` up there put every one of those visitors into
 * the denominator of an experiment they could not possibly convert in. The
 * effect would have been washed out by people who never saw a variant.
 *
 * Hooks cannot be called conditionally, but a component can be rendered
 * conditionally, and this one is rendered only when a gameday is open. So the
 * exposure fires exactly when somebody is shown the thing being tested, which
 * is the only version of that number worth dividing by.
 *
 * The rule generalises: read an experiment's flag where its treatment becomes
 * visible, not where the component that owns it happens to mount.
 */
function GamedayCall({
  day,
  summary,
  busy,
  onEnter,
  shine,
}: {
  day: Gameday;
  summary: GamedayHeroProps['summary'];
  busy: boolean;
  onEnter: (day: Gameday) => void;
  shine: Animated.Value;
}) {
  const copy = CTA_COPY[useFlag('gameday_cta')] ?? CTA_COPY.control!;

  return (
    <>
      <Text style={styles.copy}>{copy.reason(day)}</Text>

      <Pressable
        onPress={() => onEnter(day)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        accessibilityLabel={`${copy.label(day)}, ${gamedayDate(day)}`}
        style={({ pressed, hovered }: PressState) => [
          styles.cta,
          hovered && styles.ctaHover,
          pressed && styles.ctaPressed,
          busy && styles.ctaBusy,
        ]}
      >
        {/* The turnstile shine. Purely decorative: the label underneath is the
            button, and it is legible whether or not this ever runs. */}
        <Animated.View
          pointerEvents="none"
          {...DECORATIVE}
          style={[
            styles.shine,
            {
              // Faint. Caught mid-sweep at full strength it is a pale bar
              // across a third of the button, which looks like a rendering
              // fault rather than a sheen.
              opacity: shine.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.16, 0.16, 0] }),
              transform: [
                { translateX: shine.interpolate({ inputRange: [0, 1], outputRange: [-220, 320] }) },
                { rotate: '18deg' },
              ],
            },
          ]}
        />
        <Text style={styles.ctaLabel}>{busy ? 'Opening the gate…' : copy.label(day)}</Text>
        <Text style={styles.ctaSub}>
          {summary && summary.seasons > 0
            ? `${summary.seasons} ${summary.seasons === 1 ? 'season' : 'seasons'} in · best ${summary.bestRating?.toFixed(1) ?? '—'}`
            : 'Be the first season on today\u2019s board'}
        </Text>
      </Pressable>
    </>
  );
}

/**
 * Two light cones and a horizon.
 *
 * Drawn rather than shaded with plain colours so the panel has depth at the
 * top and goes to black at the bottom, which is what makes it read as a
 * stadium rather than a card. Dimmed to almost nothing when the lights are
 * off, because a dark stadium is the point of that state.
 */
function Floodlights({ live }: { live: boolean }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" {...DECORATIVE}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="gd-ground" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={live ? color.navy : color.navyDeep} stopOpacity={live ? 0.6 : 0.4} />
            <Stop offset="0.45" stopColor={color.surface} stopOpacity="0.92" />
            <Stop offset="1" stopColor={color.void} stopOpacity="1" />
          </LinearGradient>
          {/* A shaft of light is brightest where it leaves the rig and gone
              before it reaches the turf. Faint on purpose: at any strength
              where the beam is obvious, its straight edges are obvious too,
              and two hard diagonals across a panel read as geometry rather
              than as light. */}
          <LinearGradient id="gd-beam" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={live ? color.goldBright : color.silver} stopOpacity={live ? 0.1 : 0.04} />
            <Stop offset="1" stopColor={live ? color.gold : color.silver} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#gd-ground)" />
        <Path d="M10 -6 L22 -6 L40 70 L-6 70 Z" fill="url(#gd-beam)" />
        <Path d="M78 -6 L92 -6 L110 70 L62 70 Z" fill="url(#gd-beam)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  slab: {
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
    padding: space.xl,
    gap: space.md,
    shadowColor: color.void,
    shadowOpacity: 0.5,
  },
  slabLive: { borderColor: color.lineGold, backgroundColor: color.surfaceRaised },
  slabDark: { borderColor: color.line, backgroundColor: color.field },

  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  beaconRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  beacon: { width: 9, height: 9, borderRadius: radius.pill, backgroundColor: color.redBright },
  beaconOff: { backgroundColor: color.textFaint },

  kicker: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textDim,
  },
  kickerLive: { color: color.redBright },

  clock: { fontFamily: font.body, fontSize: 11, color: color.textFaint },
  clockValue: { fontFamily: font.bodyBold, color: color.silver, ...tabular },

  title: { fontFamily: font.display, fontSize: 34, lineHeight: 36, color: color.text },
  round: {
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.gold,
    marginTop: -space.sm,
  },

  fixtures: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  fixture: {
    borderWidth: 1,
    borderColor: color.lineBright,
    backgroundColor: color.chalk,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
  },
  fixtureMore: { borderColor: color.line },
  fixtureText: { fontFamily: font.body, fontSize: 11, color: color.silver },

  copy: { fontFamily: font.bodyRegular, fontSize: 13, lineHeight: 20, color: color.textDim },

  cta: {
    marginTop: space.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.gold,
    backgroundColor: color.red,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    gap: 2,
    overflow: 'hidden',
  },
  ctaHover: { backgroundColor: color.redBright, borderColor: color.goldBright },
  ctaPressed: { transform: [{ scale: 0.99 }], backgroundColor: color.redBright },
  ctaBusy: { opacity: 0.7 },
  shine: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    width: 64,
    backgroundColor: '#FFFFFF',
    opacity: 0,
  },
  ctaLabel: {
    fontFamily: font.display,
    fontSize: 20,
    letterSpacing: tracking.normal,
    textTransform: 'uppercase',
    color: color.text,
  },
  ctaSub: { fontFamily: font.body, fontSize: 11, color: '#FFE9E9' },

  closed: {
    marginTop: space.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.line,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  closedLabel: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textFaint,
  },

  note: { fontFamily: font.body, fontSize: 12, color: color.redBright },
});
