import { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFlag } from '@/features/flags';
import { DECORATIVE, color, teamWash, themed, useWindowSize } from '@/theme';
import { passThroughView } from '../../../modules/pass-through';
import {
  PLANS,
  RESTING_ALPHA,
  RESTING_BEAMS,
  RESTING_FLARE,
  RESTING_POOL,
  type Beam,
  type Bulb,
  type LightPlan,
  type LightShow,
  type RestingBeam,
} from './lights-plan';
import { isTV } from './platform';

export type { LightShow };

/**
 * Stadium lights on the Apple TV: sweeping spotlight beams and popping
 * flashbulbs at the big moments -- a spin landing, a pick locking in, the
 * record, and a 17-0.
 *
 * The phone draws its lights on the GPU (the turf's floodlights stutter on in
 * a Skia shader; the result throws a Skia firework show). None of that runs
 * on a TV (`features/gpu`): Skia drew on the thread the focus engine runs on,
 * into a 4K Metal layer, and a real Apple TV stuttered under it. So these are
 * built from what a TV composites for free -- each beam, flare and bulb is a
 * static native gradient (`experimental_backgroundImage`, a CAGradientLayer
 * drawn once) -- and moved only with transform and opacity on the UI thread,
 * which Reanimated applies without a commit (docs/apple-tv.md, "Performance").
 *
 * The budget, held by `performance.test.ts`:
 * - **At most eight animating layers** in any show: four beams, one wash,
 *   three bulbs. Each beam's lamp and cone ride inside the beam's one
 *   rotating view, so they are not layers of their own.
 * - **A show plays and then is gone.** Nothing of a show is mounted between moments;
 *   a show unmounts itself when it ends, except under the broadcast record,
 *   which holds its beams still (and costs nothing per frame) until Select.
 *   The record's beams sway twice and stop. Nothing loops.
 * - **Nothing that paints fades.** Opacity, animated on a React Native view,
 *   rebuilds that view's layer every frame: a gradient's layers are torn down
 *   and made again, a border is rasterised again on the CPU. So every fade
 *   and pop here is on a bare wrapper, and the gradient inside it is drawn
 *   once. (Transform does not rebuild the layer; the beams rotate their own.)
 * - **No Svg, no Skia, no shadow, no clip.** A clip to rounded corners over
 *   moving content is an offscreen mask pass per frame on a real TV.
 * - **Under Reduce Motion nothing sweeps or strobes.** The beams fade in where
 *   they would have come to rest, the wash rises and falls once, gently, and
 *   no bulb pops.
 * - **Photosensitivity.** The only light that covers much of the screen is
 *   the wash, a radial from the top edge that never passes about a third of
 *   full strength; it pulses once per moment, and a 17-0's gold strobe is
 *   three pulses 450 ms apart -- never more than three in a second (WCAG
 *   2.3.1). Bulbs are small and soft, far under the area that counts as a
 *   flash. Nothing strobes red: the spin's wash is the franchise colour, once.
 *
 * Behind `tv_broadcast_lights` so a TestFlight build that stutters on real
 * hardware can lose them without a release.
 */
const NEVER = ReduceMotion.Never;
const FADE = 650;
const WHITE = '#FFFFFF';

const Overlay = passThroughView();

/**
 * Plays `show` each time `cue` changes to a new non-null value. `at` is how
 * long after that the moment lands (the record's slam), so beams can lead in.
 * `bleed` extends the rig past the TV-safe insets of the screen it sits in, so
 * the lamps hang from the top of the glass rather than mid-air.
 */
export function StadiumLights({
  show,
  cue,
  at = 0,
  tint,
  hold = false,
  bleed = false,
}: {
  show: LightShow;
  cue: string | number | null;
  at?: number;
  tint?: string;
  hold?: boolean;
  bleed?: boolean;
}) {
  const on = useFlag('tv_broadcast_lights');
  if (!isTV || !on || cue === null) return null;
  return <Rig key={String(cue)} plan={PLANS[show]} at={at} tint={tint ?? (show === 'perfect' ? color.goldBright : color.actionBright)} hold={hold} bleed={bleed} />;
}

function Rig({ plan, at, tint, hold, bleed }: { plan: LightPlan; at: number; tint: string; hold: boolean; bleed: boolean }) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowSize();
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (hold) return;
    const end = setTimeout(() => setOver(true), Math.max(0, at) + plan.tail + 50);
    return () => clearTimeout(end);
  }, [hold, at, plan.tail]);

  if (over) return null;
  const edge = bleed ? { top: -insets.top, left: -insets.left, right: -insets.right, bottom: -insets.bottom } : { top: 0, left: 0, right: 0, bottom: 0 };
  return (
    <Overlay style={[styles.rig, edge]} pointerEvents="none" {...DECORATIVE}>
      {plan.wash.length ? <Wash pulses={plan.wash} peak={plan.washPeak} at={at} tint={tint} reduced={reduced} /> : null}
      {plan.beams.map((beam, i) => (
        <BeamLayer key={i} beam={beam} at={at} tail={plan.tail} hold={hold} reduced={reduced} light={beam.tinted ? tint : WHITE} width={width} height={height} />
      ))}
      {reduced
        ? null
        : plan.bulbs.map((bulb, i) => <BulbLayer key={i} bulb={bulb} at={at} repop={plan.repop} width={width} height={height} />)}
    </Overlay>
  );
}

/** Light from the top edge, rising and falling once per pulse. */
function Wash({ pulses, peak, at, tint, reduced }: { pulses: readonly number[]; peak: number; at: number; tint: string; reduced: boolean }) {
  const alpha = useSharedValue(0);
  useEffect(() => {
    const first = Math.max(0, at + pulses[0]!);
    if (reduced) {
      // One slow swell, at half strength, however many pulses the show has.
      alpha.value = withDelay(
        first,
        withSequence(withTiming(peak * 0.5, { duration: 600, reduceMotion: NEVER }), withTiming(0, { duration: 1200, reduceMotion: NEVER })),
      );
      return;
    }
    const steps = pulses.map((p, i) =>
      withDelay(
        i === 0 ? 0 : Math.max(0, p - pulses[i - 1]! - 430),
        withSequence(
          withTiming(peak, { duration: 90, easing: Easing.out(Easing.quad), reduceMotion: NEVER }),
          withTiming(0, { duration: 340, easing: Easing.in(Easing.quad), reduceMotion: NEVER }),
        ),
      ),
    );
    alpha.value = withDelay(first, steps.length === 1 ? steps[0]! : withSequence(...steps));
  }, [alpha, pulses, peak, at, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: alpha.value }));
  // The fade is on a wrapper that paints nothing: see "Nothing that paints fades".
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <View
        style={[
          StyleSheet.absoluteFill,
          { experimental_backgroundImage: `radial-gradient(ellipse 75% 70% at 50% 0%, ${teamWash(tint, 0.42)} 0%, ${teamWash(tint, 0.12)} 55%, ${teamWash(tint, 0)} 100%)` },
        ]}
      />
    </Animated.View>
  );
}

/**
 * One searchlight: a lamp and its cone in a view twice the beam's length,
 * centred on the lamp, so rotating the view swings the beam about the lamp
 * (the cone fills the lower half). The cone is a soft radial on a narrow view,
 * tipped back in perspective so it widens away from the lamp -- a static 3D
 * transform, composited, never redrawn.
 */
function BeamLayer({
  beam,
  at,
  tail,
  hold,
  reduced,
  light,
  width,
  height,
}: {
  beam: Beam;
  at: number;
  tail: number;
  hold: boolean;
  reduced: boolean;
  light: string;
  width: number;
  height: number;
}) {
  const angle = useSharedValue(reduced ? beam.rest : beam.from);
  const alpha = useSharedValue(0);
  const cone = Math.round(height * 1.6);

  useEffect(() => {
    const start = Math.max(0, at + beam.delay);
    const lit = 0.9;
    const until = Math.max(0, at + tail - FADE - start - 300);
    const out = hold ? withTiming(lit * 0.6, { duration: 900, reduceMotion: NEVER }) : withTiming(0, { duration: FADE, reduceMotion: NEVER });
    if (reduced) {
      alpha.value = withDelay(start, withSequence(withTiming(lit * 0.6, { duration: 700, reduceMotion: NEVER }), withDelay(until, out)));
      return;
    }
    alpha.value = withDelay(start, withSequence(withTiming(lit, { duration: 280, reduceMotion: NEVER }), withDelay(until, out)));
    const sweep = withTiming(beam.to, { duration: beam.sweep, easing: Easing.inOut(Easing.cubic), reduceMotion: NEVER });
    const settle = withTiming(beam.rest, { duration: 700, easing: Easing.out(Easing.cubic), reduceMotion: NEVER });
    // Held under the record: two slow sways, then still for as long as it is up.
    const sway = hold
      ? [
          withRepeat(
            withSequence(
              withTiming(beam.rest + 7, { duration: 2200, easing: Easing.inOut(Easing.sin), reduceMotion: NEVER }),
              withTiming(beam.rest - 7, { duration: 2200, easing: Easing.inOut(Easing.sin), reduceMotion: NEVER }),
            ),
            2,
            false,
          ),
          withTiming(beam.rest, { duration: 1400, easing: Easing.inOut(Easing.sin), reduceMotion: NEVER }),
        ]
      : [];
    angle.value = withDelay(start, withSequence(sweep, settle, ...sway));
  }, [angle, alpha, beam, at, tail, hold, reduced]);

  const style = useAnimatedStyle(() => ({ opacity: alpha.value, transform: [{ rotate: `${angle.value}deg` }] }));

  return (
    <Animated.View style={[styles.beam, { left: beam.x * width - BEAM_W / 2, top: -LAMP_DROP - cone, height: cone * 2 }, style]}>
      <BeamBody cone={cone} light={light} />
    </Animated.View>
  );
}

/**
 * A beam's lamp and cone, static: drawn once and only ever moved by the view
 * around them.
 *
 * Tipped back in perspective about its own centre, the cone's top edge
 * projects nearer the middle than it was laid out: it is laid out lower by
 * that much, so the projected cone starts at the lamp.
 */
function BeamBody({ cone, light }: { cone: number; light: string }) {
  const p = cone * PERSPECTIVE;
  const sTop = p / (p + (cone / 2) * Math.sin(TILT));
  const lift = (cone / 2) * (1 - Math.cos(TILT) * sTop);
  return (
    <>
      <View
        style={[
          styles.cone,
          {
            top: cone - lift,
            height: cone,
            transform: [{ perspective: p }, { rotateX: `${TILT_DEG}deg` }],
            experimental_backgroundImage: `radial-gradient(ellipse 50% 100% at 50% 0%, ${teamWash(light, 0.5)} 0%, ${teamWash(light, 0.2)} 35%, ${teamWash(light, 0)} 100%)`,
          },
        ]}
      />
      <View
        style={[
          styles.lamp,
          {
            top: cone - LAMP / 2,
            experimental_backgroundImage: `radial-gradient(ellipse 50% 50% at 50% 50%, ${teamWash(WHITE, 0.95)} 0%, ${teamWash(light, 0.55)} 22%, ${teamWash(light, 0)} 100%)`,
          },
        ]}
      />
    </>
  );
}

/** A camera flash in the stands: a soft white pop, once (or twice at 17-0). */
function BulbLayer({ bulb, at, repop, width, height }: { bulb: Bulb; at: number; repop: number; width: number; height: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    const pop = () =>
      withSequence(
        withTiming(1, { duration: 50, easing: Easing.out(Easing.quad), reduceMotion: NEVER }),
        withTiming(0, { duration: 300, easing: Easing.in(Easing.quad), reduceMotion: NEVER }),
      );
    const start = Math.max(0, at + bulb.delay);
    p.value = withDelay(start, repop ? withSequence(pop(), withDelay(repop - 350, pop())) : pop());
  }, [p, bulb, at, repop]);
  const style = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: 0.55 + 0.6 * p.value }] }));
  return (
    <Animated.View style={[styles.bulbSeat, { left: bulb.x * width - BULB / 2, top: bulb.y * height - BULB / 2 }, style]}>
      <View style={styles.bulb} />
    </Animated.View>
  );
}

const BEAM_W = 170;
const TILT_DEG = 45;
const TILT = (TILT_DEG * Math.PI) / 180;
const PERSPECTIVE = 0.8;
const LAMP = 120;
// The lamp hangs above the glass: swung wide, the cone's top edge is a hard
// line where the view ends, and at 14 points it showed in the corners.
const LAMP_DROP = 44;
const BULB = 92;
/** A standing lamp's centre, above the top of the glass. */
const RESTING_DROP = 14;

const styles = themed(() =>
  StyleSheet.create({
  rig: { position: 'absolute' },
  beam: { position: 'absolute', width: BEAM_W },
  cone: { position: 'absolute', left: 0, width: BEAM_W },
  lamp: { position: 'absolute', left: BEAM_W / 2 - LAMP / 2, width: LAMP, height: LAMP },
  // Where the field is lit: a soft white ellipse, a fraction of full strength.
  pool: {
    position: 'absolute',
    experimental_backgroundImage: `radial-gradient(ellipse 50% 50% at 50% 50%, ${teamWash(WHITE, 0.15)} 0%, ${teamWash(WHITE, 0.07)} 45%, ${teamWash(WHITE, 0)} 100%)`,
  },
  bulbSeat: { position: 'absolute', width: BULB, height: BULB },
  bulb: {
    width: BULB,
    height: BULB,
    experimental_backgroundImage: `radial-gradient(ellipse 50% 50% at 50% 50%, ${teamWash(WHITE, 0.95)} 0%, ${teamWash(WHITE, 0.35)} 16%, ${teamWash(WHITE, 0)} 100%)`,
  },
  }),
);

/**
 * The play screen's lights: two lamps that stand lit over the field and the
 * hero for as long as the screen is up, and a show for each spin landing and
 * pick locking in, read from the same facts the broadcast HUD reads. Whatever
 * is already on screen when it mounts (a resumed game) is not a moment, and
 * plays nothing.
 */
export const PlayLights = memo(function PlayLights({
  landed,
  picks,
  teamColor,
}: {
  /** The landed spin's sequence while a pick is open; null otherwise. */
  landed: number | null;
  picks: number;
  /** The landed franchise's colour, for the spin's wash. */
  teamColor?: string;
}) {
  const [moment, setMoment] = useState<{ show: LightShow; cue: string; tint?: string } | null>(null);
  const lastSpin = useRef(landed);
  const lastPicks = useRef(picks);
  useEffect(() => {
    if (landed !== null && landed !== lastSpin.current) setMoment({ show: 'spin', cue: `s${landed}`, tint: teamColor });
    lastSpin.current = landed;
  }, [landed, teamColor]);
  useEffect(() => {
    if (picks > lastPicks.current) setMoment({ show: 'pick', cue: `p${picks}` });
    lastPicks.current = picks;
  }, [picks]);
  return (
    <>
      <RestingLights flare={moment?.cue ?? null} />
      {moment ? <StadiumLights show={moment.show} cue={moment.cue} tint={moment.tint} bleed /> : null}
    </>
  );
});

/**
 * The standing lights (`RESTING_BEAMS`, `RESTING_POOL`): the stadium is lit
 * while you pick, not only at the moments.
 *
 * Three layers, and nothing moves while the screen is still: no loop, no
 * frame callback, nothing on the JS thread. A resting layer costs the
 * compositor and nothing else (docs/apple-tv.md, "Stadium lights"). A moment
 * (`flare` changing) brightens both beams and swings them out and back on the
 * UI thread, once. Under Reduce Motion they stand lit and never swing.
 */
function RestingLights({ flare }: { flare: string | number | null }) {
  const on = useFlag('tv_broadcast_lights');
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowSize();
  if (!isTV || !on) return null;
  const pool = RESTING_POOL;
  return (
    <Overlay style={[styles.rig, { top: -insets.top, left: -insets.left, right: -insets.right, bottom: -insets.bottom }]} pointerEvents="none" {...DECORATIVE}>
      <View
        style={[
          styles.pool,
          {
            left: (pool.x - pool.w / 2) * width,
            top: (pool.y - pool.h / 2) * height,
            width: pool.w * width,
            height: pool.h * height,
          },
        ]}
      />
      {RESTING_BEAMS.map((beam, i) => (
        <RestingBeamLayer key={i} beam={beam} flare={flare} reduced={reduced} width={width} height={height} />
      ))}
    </Overlay>
  );
}

function RestingBeamLayer({
  beam,
  flare,
  reduced,
  width,
  height,
}: {
  beam: RestingBeam;
  flare: string | number | null;
  reduced: boolean;
  width: number;
  height: number;
}) {
  const angle = useSharedValue(beam.rest);
  const alpha = useSharedValue(0);
  const cone = Math.round(height * 1.6);

  // Lit as the screen arrives, once.
  useEffect(() => {
    alpha.value = withTiming(RESTING_ALPHA, { duration: 900, easing: Easing.out(Easing.quad), reduceMotion: NEVER });
  }, [alpha]);

  useEffect(() => {
    if (flare === null || reduced) return;
    alpha.value = withSequence(
      withTiming(RESTING_FLARE, { duration: 220, easing: Easing.out(Easing.quad), reduceMotion: NEVER }),
      withDelay(350, withTiming(RESTING_ALPHA, { duration: 900, easing: Easing.inOut(Easing.quad), reduceMotion: NEVER })),
    );
    angle.value = withSequence(
      withTiming(beam.rest + beam.swing, { duration: 480, easing: Easing.inOut(Easing.cubic), reduceMotion: NEVER }),
      withTiming(beam.rest, { duration: 1100, easing: Easing.out(Easing.cubic), reduceMotion: NEVER }),
    );
  }, [flare, reduced, alpha, angle, beam]);

  const style = useAnimatedStyle(() => ({ opacity: alpha.value, transform: [{ rotate: `${angle.value}deg` }] }));
  return (
    // The lamp hangs just inside the glass, so its glow shows at the top
    // edge: these stay up, and a light with no visible source reads as haze.
    <Animated.View style={[styles.beam, { left: beam.x * width - BEAM_W / 2, top: -RESTING_DROP - cone, height: cone * 2 }, style]}>
      <BeamBody cone={cone} light={beam.tinted ? color.actionBright : WHITE} />
    </Animated.View>
  );
}
