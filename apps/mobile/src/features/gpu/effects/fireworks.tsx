import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlendMode, Canvas, Picture, Skia, createPicture } from '@shopify/react-native-skia';
import { Easing, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { buildShow, type Show as ShowPlan } from '../show';

/**
 * Fireworks and confetti, as one picture redrawn every frame on the GPU.
 *
 * The view-based celebration it replaces animated each confetto as its own
 * native view, which caps out around a hundred pieces before a phone drops
 * frames. Here every piece is a draw call in one Skia picture, so a 17-0 can
 * have three hundred pieces of confetti, seven shells and a few hundred
 * sparks, and still hold 120 Hz on a ProMotion screen.
 *
 * Everything is a closed-form function of one clock (`./show.ts`): no
 * per-frame state, nothing to step, and the animation ends on its own when the
 * clock reaches the end of the show -- nothing keeps a canvas redrawing after
 * the party.
 *
 * On a Duo opened like a book the shells launch out of the fold and burst over
 * both pages (`origin`); anywhere else they rise from along the bottom.
 */
export default function Fireworks({
  intensity,
  palette,
  perfect,
  origin,
}: {
  intensity: number;
  palette: readonly string[];
  perfect: boolean;
  /** The fold, in window coordinates. */
  origin: { x: number; y: number } | null;
}) {
  // The overlay is measured rather than assumed to be the window: on a wide
  // screen the result sits in a column, and a show laid out across the window
  // put most of its shells outside the canvas that draws them.
  const ref = useRef<View>(null);
  const screen = useWindowDimensions();
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const measure = () =>
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setBox((b) => (b && b.width === width && b.height === height ? b : { x, y, width, height }));
    });

  if (!box) return <View ref={ref} style={StyleSheet.absoluteFill} onLayout={measure} pointerEvents="none" />;
  return (
    <View ref={ref} style={StyleSheet.absoluteFill} onLayout={measure} pointerEvents="none">
      <Show
        width={box.width}
        // An overlay on a long scrolling result is taller than the screen; the show
        // is for the part anyone can see.
        height={Math.min(box.height, screen.height)}
        intensity={intensity}
        palette={palette}
        perfect={perfect}
        origin={origin ? { x: origin.x - box.x, y: origin.y - box.y } : null}
      />
    </View>
  );
}

function Show({
  width,
  height,
  intensity,
  palette,
  perfect,
  origin,
}: {
  width: number;
  height: number;
  intensity: number;
  palette: readonly string[];
  perfect: boolean;
  origin: { x: number; y: number } | null;
}) {
  const show = useMemo<ShowPlan>(
    () => buildShow({ width, height, intensity, perfect, origin, colors: palette.length }),
    // A celebration is thrown once per arrival; a palette re-render must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, intensity, perfect],
  );
  const colors = useMemo(() => palette.map((c) => Skia.Color(c)), [palette]);
  const clock = useSharedValue(0);

  useEffect(() => {
    clock.value = withTiming(show.duration, { duration: show.duration * 1000, easing: Easing.linear });
  }, [clock, show.duration]);

  const picture = useDerivedValue(() => {
    const t = clock.value;
    return createPicture((canvas) => {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);

      // Confetti: a flutter is a rectangle whose height follows |cos| of its flip.
      for (let i = 0; i < show.confetti.length; i++) {
        const c = show.confetti[i]!;
        const local = t - c.delay;
        if (local <= 0) continue;
        const y = c.y + c.vy * local + 0.5 * 70 * local * local;
        if (y > height + 30) continue;
        const x = c.x + c.vx * local + c.sway * Math.sin(c.freq * local + c.phase);
        const fade = t > show.duration - 0.8 ? Math.max((show.duration - t) / 0.8, 0) : 1;
        paint.setColor(colors[c.color % colors.length]!);
        paint.setAlphaf(fade);
        const flip = Math.abs(Math.cos(c.flip * local));
        canvas.save();
        canvas.translate(x, y);
        canvas.rotate(c.spin * local * 57.3, 0, 0);
        canvas.drawRect(Skia.XYWHRect(-c.size / 2, (-c.size * c.ratio * flip) / 2, c.size, c.size * c.ratio * flip), paint);
        canvas.restore();
      }

      // Shells: a rising spark with a tail, then a ring of sparks that falls and fades.
      paint.setBlendMode(BlendMode.Plus);
      for (let s = 0; s < show.shells.length; s++) {
        const shell = show.shells[s]!;
        const local = t - shell.launch;
        if (local <= 0) continue;
        paint.setColor(colors[shell.color % colors.length]!);
        if (local < shell.rise) {
          const k = local / shell.rise;
          const ease = 1 - (1 - k) * (1 - k);
          const x = shell.fromX + (shell.x - shell.fromX) * ease;
          const y = shell.fromY + (shell.y - shell.fromY) * ease;
          for (let tail = 0; tail < 6; tail++) {
            const back = Math.max(ease - tail * 0.035, 0);
            paint.setAlphaf(0.9 - tail * 0.14);
            canvas.drawCircle(
              shell.fromX + (shell.x - shell.fromX) * back,
              shell.fromY + (shell.y - shell.fromY) * back,
              2.6 - tail * 0.3,
              paint,
            );
          }
          paint.setAlphaf(1);
          canvas.drawCircle(x, y, 3.2, paint);
          continue;
        }
        const age = local - shell.rise;
        if (age > shell.life) continue;
        const fade = 1 - age / shell.life;
        // The flash of the burst itself.
        if (age < 0.18) {
          paint.setAlphaf((1 - age / 0.18) * 0.55);
          canvas.drawCircle(shell.x, shell.y, 26 + 120 * age, paint);
        }
        for (let k = 0; k < shell.sparks; k++) {
          const angle = (k / shell.sparks) * Math.PI * 2 + shell.twist;
          const speed = shell.speed * (0.82 + 0.18 * Math.sin(k * 12.9898));
          const drag = (1 - Math.exp(-age * 2.2)) / 2.2;
          const x = shell.x + Math.cos(angle) * speed * drag;
          const y = shell.y + Math.sin(angle) * speed * drag + 0.5 * 110 * age * age;
          const twinkle = 0.65 + 0.35 * Math.sin(age * 30 + k);
          paint.setAlphaf(fade * fade * twinkle);
          canvas.drawCircle(x, y, 1.4 + 1.6 * fade, paint);
          paint.setAlphaf(fade * fade * 0.18);
          canvas.drawCircle(x, y, 5 * fade + 1, paint);
        }
      }
    }, { width, height });
  });

  return (
    <Canvas style={{ position: 'absolute', left: 0, top: 0, width, height }} pointerEvents="none">
      <Picture picture={picture} />
    </Canvas>
  );
}
