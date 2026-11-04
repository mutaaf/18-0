import { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useDerivedValue, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { rgb } from '../color';

/**
 * The grass under the lineup, lit like a stadium.
 *
 * Ten-yard mowing bands, a fine grain so the green is not a flat fill, four
 * floodlight pools from the corners, and a slow sheen that crosses the field
 * every half a minute or so. When the field first appears the lights come on
 * the way stadium lights do -- a stutter, then full -- because that is the
 * moment a kid looking at a Duo opened like a book should feel it.
 *
 * `bend` is how far the device is folded (0 flat, 1 a right angle). Folded is
 * held like a book in two hands, so the lights burn a little brighter; that is
 * all the hinge does here.
 *
 * Reduce Motion keeps the picture and stops the clock: the lights are already
 * on, and nothing sweeps.
 */
const SOURCE = `
uniform float2 size;
uniform float time;
uniform float on;
uniform float bend;
uniform float3 deep;
uniform float3 lit;
uniform float3 glow;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float pool(float2 uv, float2 at, float spread) {
  float2 d = uv - at;
  return exp(-dot(d, d) * spread);
}

half4 main(float2 p) {
  float2 uv = p / size;

  // Lights: a stutter over the first 0.7 s, then a ramp to full.
  float lights = clamp(on / 1.1, 0.0, 1.0);
  if (on < 0.7) { lights *= step(0.45, fract(on * 7.3)); }
  lights *= 1.0 + 0.3 * bend;

  float band = mod(floor(uv.y * 10.0), 2.0);
  float3 col = mix(deep, lit, 0.45 + 0.2 * band);

  float grain = hash(floor(p * 0.8));
  col += (grain - 0.5) * 0.03;

  float pools = pool(uv, float2(-0.08, -0.06), 3.2) + pool(uv, float2(1.08, -0.06), 3.2)
              + 0.55 * pool(uv, float2(-0.08, 1.06), 3.6) + 0.55 * pool(uv, float2(1.08, 1.06), 3.6);
  col += float3(1.0, 0.97, 0.88) * pools * 0.13 * lights;

  float sweep = uv.x * 0.8 + uv.y * 0.6 - mod(time * 0.055, 2.8) + 0.5;
  col += glow * exp(-sweep * sweep * 36.0) * 0.16 * lights;

  float2 c = uv - 0.5;
  col *= 1.0 - dot(c, c) * (1.1 - 0.35 * lights);

  return half4(half3(col), 1.0);
}`;

export default function TurfShader({
  width,
  height,
  bend,
  colors,
}: {
  width: number;
  height: number;
  bend: number;
  colors: { deep: string; lit: string; glow: string };
}) {
  const effect = useMemo(() => Skia.RuntimeEffect.Make(SOURCE), []);
  const reduced = useReducedMotion();
  const clock = useClock();
  const folded = useSharedValue(bend);

  useEffect(() => {
    folded.value = withTiming(bend, { duration: 260 });
  }, [bend, folded]);

  const deep = rgb(colors.deep);
  const lit = rgb(colors.lit);
  const glow = rgb(colors.glow);

  const uniforms = useDerivedValue(() => {
    // The clock counts from this canvas's first frame, so it is also the time
    // since the lights were switched on. Under Reduce Motion it is not read at
    // all, so nothing subscribes to it and the canvas stops redrawing.
    const seconds = reduced ? 12 : clock.value / 1000;
    return {
      size: [width, height],
      time: seconds,
      on: seconds,
      bend: folded.value,
      deep,
      lit,
      glow,
    };
  });

  if (!effect || width <= 0 || height <= 0) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
