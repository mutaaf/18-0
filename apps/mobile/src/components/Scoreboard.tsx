import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Crown } from '@/components/Crown';
import {
  DROP_IN,
  EASE_OUT,
  FLARE,
  ImpactRing,
  STAMP,
  Sheen,
  type Timeline,
  keyframes,
  useRoll,
} from '@/components/Broadcast';
import {
  DECORATIVE,
  color,
  elevate,
  font,
  radius,
  space,
  tabular,
  themed,
  tracking,
} from '@/theme';

/**
 * The rundown.
 *
 * Every time on this screen is stated here, in milliseconds from the moment the
 * result mounts, because the alternative — a delay on each component, each one
 * relative to the last — is a sequence nobody can re-time without re-deriving
 * all of it. Read it top to bottom and you have the broadcast: a rule wipes in,
 * the panel unfolds off it, the slate builds, the digits drop and roll, the
 * record locks, the tier stamps, the rating counts, the chase meter fills, and
 * the roster deals underneath.
 *
 * The whole thing is 2.6 seconds and a tap on the panel ends it early. That
 * ceiling is deliberate: this is the screen a player sees after every single
 * season, so it has to survive the fiftieth viewing as well as the first.
 */
export const CUE = {
  /** A rule wipes across where the panel is about to be. */
  wipe: 0,
  /** The panel unfolds off that rule. */
  plate: 80,
  /** The slate: kicker and its two rules. */
  slate: 260,
  /** Digits drop in at 0-0 and start rolling. */
  digits: 400,
  /** The record locks. Flare, sheen, and the haptic. */
  lock: 1040,
  /** The tier stamps on. The celebration belongs to this frame, not its own. */
  stamp: 1100,
  /** The rating counts up. */
  rating: 1340,
  /** The chase meter fills to its mark. */
  meter: 1560,
  /** Badges, board switch and the buttons. */
  tail: 1720,
  /** The roster deals, one row at a time. */
  roster: 1800,
  /** How long the rundown is. */
  end: 2600,
} as const;

/** How long a row waits behind the one above it. */
export const ROSTER_STEP = 44;

const ROLL = CUE.lock - CUE.digits;

export function Scoreboard({
  line,
  wins,
  losses,
  label,
  tier,
  rating,
  accent,
  perfect,
  recordSize,
  crownSize,
  summary,
}: {
  line: Timeline;
  wins: number;
  losses: number;
  /** Already upper-cased by the caller, which knows about PERFECT. */
  label: string;
  tier: string;
  rating: number;
  accent: string;
  perfect: boolean;
  recordSize: number;
  crownSize: number;
  /** The whole result in one sentence, for anyone who is not watching it. */
  summary: string;
}) {
  const { t, settled } = line;

  // Both counters climb from 0-0 and meet at the record, which is what the pip
  // strip underneath is drawing: a season being played, not a number being
  // faded in. Counting the losses *down* from the schedule length was tried
  // first and read as "you have lost every game" for the first half-second.
  const games = wins + losses;
  const winRoll = useRoll(wins, 0, CUE.digits, ROLL, settled);
  // Sixty milliseconds behind the wins, and sixty shorter, so both counters
  // stop on the same frame the record locks and the flare belongs to a number
  // that has finished moving.
  const lossRoll = useRoll(losses, 0, CUE.digits + 60, ROLL - 60, settled);
  const ratingRoll = useRoll(rating, 0, CUE.rating, 620, settled);
  const shownWins = Math.round(winRoll);
  const shownLosses = Math.round(lossRoll);

  const glow = useRef(new Animated.Value(0)).current;

  // 18-0 breathes. Nothing else in the app does, and it starts on the stamp
  // rather than on mount so the panel is not already pulsing while it builds.
  useEffect(() => {
    if (!perfect) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1700,
          delay: CUE.stamp,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [perfect, glow]);

  /**
   * Every layer of the graphic, built once.
   *
   * The three tickers above re-render this component roughly twenty times a
   * second while they roll. Built in the render body, each of these is a fresh
   * Animated node attached and detached on every one of those passes — which is
   * the difference between a sequence that holds 60fps on a mid-range phone and
   * one that does not.
   */
  const cue = useMemo(() => {
    const plate = keyframes(t, CUE.plate, 300, EASE_OUT);
    const stamp = keyframes(t, CUE.stamp, 340, STAMP);
    const meta = keyframes(t, CUE.rating - 90, 260, EASE_OUT);
    const crown = keyframes(t, CUE.stamp - 90, 420, DROP_IN);
    const unit = { inputRange: [0, 1] };
    return {
      plateFade: plate,
      unfold: plate.interpolate({ ...unit, outputRange: [0.06, 1] }),
      wipe: keyframes(t, CUE.wipe, 170, EASE_OUT),
      wipeOut: keyframes(t, CUE.plate + 70, 220, [1, 0.35, 0]),
      slate: keyframes(t, CUE.slate, 220, EASE_OUT),
      winDrop: keyframes(t, CUE.digits, 320, DROP_IN),
      lossDrop: keyframes(t, CUE.digits + 70, 320, DROP_IN),
      bar: keyframes(t, CUE.digits + 40, 260, EASE_OUT),
      strip: keyframes(t, CUE.digits + 120, 240, EASE_OUT),
      lockFlare: keyframes(t, CUE.lock, 300, FLARE),
      lockBump: keyframes(t, CUE.lock, 420, [1, 1.055, 0.994, 1.003, 1]),
      stampIn: keyframes(t, CUE.stamp, 140, EASE_OUT),
      stampScale: stamp.interpolate({ ...unit, outputRange: [1.6, 1] }),
      immortal: keyframes(t, CUE.stamp + 200, 260, EASE_OUT),
      metaFade: meta,
      metaLift: meta.interpolate({ ...unit, outputRange: [8, 0] }),
      crownFade: crown,
      crownScale: crown.interpolate({ ...unit, outputRange: [0.7, 1] }),
      crownLift: crown.interpolate({ ...unit, outputRange: [16, 0] }),
      breathe: glow.interpolate({ ...unit, outputRange: [0.16, 0.42] }),
    };
  }, [t, glow]);

  return (
    <View style={styles.halo}>
      {perfect ? (
        /* A ring, not a fill. As a filled rectangle behind the card this relied
           on the card's own background to mask its middle, which held on native
           and not on the web -- where the record came out gold on gold on the
           one screen the entire game exists for. A border has no interior to
           leak. */
        <Animated.View
          pointerEvents="none"
          {...DECORATIVE}
          style={[
            styles.glow,
            { opacity: cue.breathe },
          ]}
        />
      ) : null}

      <View style={styles.hero} accessible accessibilityLabel={summary}>
        <Animated.View
          pointerEvents="none"
          {...DECORATIVE}
          style={[
            styles.plate,
            { borderColor: `${accent}4D` },
            perfect && styles.platePerfect,
            { opacity: cue.plateFade, transform: [{ scaleY: cue.unfold }] },
          ]}
        />

        {/* The line the panel unfolds off. It has to be drawn outside the plate,
            because the plate is what is still 6% tall while this is crossing. */}
        <Animated.View
          pointerEvents="none"
          {...DECORATIVE}
          style={[
            styles.wipe,
            {
              backgroundColor: accent,
              opacity: cue.wipeOut,
              transform: [{ scaleX: cue.wipe }],
            },
          ]}
        />

        <View style={styles.clip} pointerEvents="none" {...DECORATIVE}>
          <Sheen t={t} at={CUE.lock} />
        </View>
        <ImpactRing t={t} at={CUE.stamp} size={recordSize * 1.7} tint={accent} />

        <View style={styles.content}>
          {perfect ? (
            <Animated.View
              style={{
                opacity: cue.crownFade,
                transform: [{ scale: cue.crownScale }, { translateY: cue.crownLift }],
              }}
            >
              <Crown size={crownSize} />
            </Animated.View>
          ) : null}

          <Animated.View style={[styles.slate, { opacity: cue.slate }]}>
            <Animated.View style={[styles.slateRule, { transform: [{ scaleX: cue.slate }] }]} />
            <Text style={styles.kicker}>Projected Record</Text>
            <Animated.View style={[styles.slateRule, { transform: [{ scaleX: cue.slate }] }]} />
          </Animated.View>

          <Animated.View style={[styles.recordRow, { transform: [{ scale: cue.lockBump }] }]}>
            <Digit
              value={shownWins}
              size={recordSize}
              drop={cue.winDrop}
              flare={cue.lockFlare}
              perfect={perfect}
            />
            <Animated.View
              style={[
                styles.recordBar,
                { backgroundColor: accent, height: recordSize * 0.09, transform: [{ scaleX: cue.bar }] },
              ]}
            />
            <Digit
              value={shownLosses}
              size={recordSize}
              drop={cue.lossDrop}
              flare={cue.lockFlare}
              perfect={perfect}
            />
          </Animated.View>

          {/* The season, drawn: wins light from the left, losses from the
              right, and the gap between them closes as the counters roll. The
              upper bound is a sanity rail rather than a rule — a schedule long
              enough to break it would make each pip a hairline anyway. */}
          {games > 0 && games <= 40 ? (
            <Animated.View style={[styles.pips, { opacity: cue.strip }]} {...DECORATIVE}>
              {Array.from({ length: games }, (_, i) => (
                <View
                  key={i}
                  style={[
                    styles.pip,
                    i < shownWins
                      ? { backgroundColor: accent }
                      : i >= games - shownLosses
                        ? styles.pipLost
                        : null,
                  ]}
                />
              ))}
            </Animated.View>
          ) : null}

          <Animated.Text
            style={[
              styles.endingName,
              {
                color: accent,
                opacity: cue.stampIn,
                transform: [{ scale: cue.stampScale }],
              },
            ]}
          >
            {label}
          </Animated.Text>

          {perfect ? (
            <Animated.Text style={[styles.immortal, { opacity: cue.immortal }]}>IMMORTAL</Animated.Text>
          ) : null}

          <Animated.View
            style={[
              styles.heroMeta,
              {
                opacity: cue.metaFade,
                transform: [{ translateY: cue.metaLift }],
              },
            ]}
          >
            <Text style={styles.metaLabel}>
              TIER <Text style={{ color: accent }}>{tier}</Text>
            </Text>
            <View style={styles.metaDot} />
            <Text style={styles.metaRating}>
              {ratingRoll.toFixed(1)}
              <Text style={styles.metaLabel}> RATING</Text>
            </Text>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

/**
 * One half of the record.
 *
 * The flare is a second copy of the same number painted over the first at the
 * moment it locks, rather than an animated colour: colour cannot be driven
 * natively, and this number is large enough that dropping off the native driver
 * for it is visible on a mid-range phone.
 */
function Digit({
  value,
  size,
  drop,
  flare,
  perfect,
}: {
  value: number;
  size: number;
  drop: Animated.AnimatedInterpolation<number>;
  flare: Animated.AnimatedInterpolation<number>;
  perfect: boolean;
}) {
  const style = [
    styles.recordNum,
    { fontSize: size, lineHeight: size * 1.04 },
    perfect && styles.recordPerfect,
  ];
  const land = useMemo(
    () => ({
      // Clamped: the drop overshoots past 1 on purpose, and an opacity above it
      // is only clamped by the platform by luck rather than by contract.
      fade: drop.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
      fall: drop.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.5, 0] }),
    }),
    [drop, size],
  );

  return (
    <Animated.View
      style={{ opacity: land.fade, transform: [{ translateY: land.fall }] }}
    >
      <Text maxFontSizeMultiplier={1.15} style={style}>
        {value}
      </Text>
      <Animated.Text
        maxFontSizeMultiplier={1.15}
        {...DECORATIVE}
        style={[...style, styles.recordFlare, { opacity: flare }]}
      >
        {value}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  /** Holds the card above its own halo, on both paint models. */
  halo: { width: '100%' },
  glow: {
    position: 'absolute',
    top: -22,
    left: -22,
    right: -22,
    bottom: -22,
    borderRadius: radius.lg + 22,
    borderWidth: 22,
    borderColor: color.gold,
  },

  hero: {
    paddingTop: space.xl,
    paddingBottom: space.lg,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    zIndex: 1,
  },
  /**
   * The panel's own surface, split out from the layout above it so the unfold
   * scales a rectangle rather than the type inside it. Squashing the record to
   * 6% of its height and back was the first version, and for two frames it made
   * the one number that matters unreadable.
   */
  plate: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 1,
    borderRadius: radius.lg,
    backgroundColor: color.ink,
  },
  platePerfect: {
    borderColor: `${color.gold}80`,
    shadowColor: color.gold,
    ...elevate(14),
    shadowOffset: { width: 0, height: 0 },
  },
  wipe: { position: 'absolute', left: 0, right: 0, top: '50%', height: 2 },
  /** Clips the sheen to the panel. Nothing else may live in here. */
  clip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  content: { width: '100%', alignItems: 'center', zIndex: 1 },

  slate: { flexDirection: 'row', alignItems: 'center', gap: space.sm, width: '100%' },
  slateRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.line },
  kicker: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },

  recordRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 2 },
  recordNum: {
    fontFamily: font.display,
    color: color.text,
    includeFontPadding: false,
    textShadowColor: color.goldGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
    ...tabular,
  },
  recordFlare: { position: 'absolute', left: 0, top: 0, color: '#FFFFFF' },
  recordPerfect: { color: color.goldBright },
  recordBar: { width: 26, borderRadius: 3 },

  pips: { flexDirection: 'row', gap: 3, width: '100%', marginTop: space.sm },
  pip: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.line },
  pipLost: { backgroundColor: color.lineBright },

  endingName: {
    fontFamily: font.display,
    fontSize: 28,
    letterSpacing: tracking.wide,
    includeFontPadding: false,
    marginTop: space.sm,
  },
  immortal: {
    fontFamily: font.display,
    fontSize: 15,
    letterSpacing: 7,
    color: color.gold,
    marginTop: 4,
  },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  metaLabel: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    color: color.textFaint,
  },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: color.textFaint },
  metaRating: { fontFamily: font.display, fontSize: 17, color: color.text, ...tabular },
}));
