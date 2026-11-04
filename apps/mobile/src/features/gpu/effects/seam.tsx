import { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useDerivedValue, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { rgb } from '../color';

/**
 * The light in the fold.
 *
 * Flat, the seam is a quiet line with a slow pulse of field-green and ice
 * travelling along it -- enough to say "these are two pages". Bend the Duo and
 * the pages fall into shadow on either side of the spine while the line itself
 * brightens, so the more it folds, the more it glows: the hinge is the one
 * thing no other phone has, and this is where the app admits it.
 *
 * Layout never reads the angle (see `features/fold/spread.ts`); light does.
 * On a virtual seam -- a wide browser window -- there is no hinge, so it stays
 * at its flat level.
 */
const SOURCE = `
uniform float2 size;
uniform float time;
uniform float bend;
uniform float columns;
uniform float3 green;
uniform float3 ice;
uniform float3 shade;

half4 main(float2 p) {
  float2 uv = p / size;
  float across = columns > 0.5 ? uv.x : uv.y;
  float along = columns > 0.5 ? uv.y : uv.x;
  float d = abs(across - 0.5) * 2.0;

  float ends = smoothstep(0.0, 0.1, along) * smoothstep(1.0, 0.9, along);
  float energy = mix(0.35, 1.0, bend);

  float wave = 0.5 + 0.5 * sin(along * 11.0 - time * 2.4);
  float3 light = mix(ice, green, 0.5 + 0.5 * sin(time * 0.6 + along * 2.5));

  float core = exp(-d * d * 70.0) * (0.3 + 0.7 * wave) * energy * ends;
  float halo = exp(-d * d * 7.0) * 0.22 * energy * ends;
  float shadow = (1.0 - d) * 0.5 * bend;

  float a = clamp(core + halo + shadow, 0.0, 1.0);
  float3 rgbp = light * (core + halo) + shade * shadow;
  return half4(half3(rgbp), a);
}`;

export default function SeamGlow({
  columns,
  bend,
  colors,
}: {
  columns: boolean;
  bend: number;
  colors: { green: string; ice: string; shade: string };
}) {
  const effect = useMemo(() => Skia.RuntimeEffect.Make(SOURCE), []);
  const reduced = useReducedMotion();
  const clock = useClock();
  const bent = useSharedValue(bend);
  const size = useSharedValue({ width: 0, height: 0 });

  useEffect(() => {
    // A spring, because a hinge reports in whole degrees and a light that
    // steps once per degree flickers while the device is being folded.
    bent.value = withSpring(bend, { damping: 18, stiffness: 120 });
  }, [bend, bent]);

  const green = rgb(colors.green);
  const ice = rgb(colors.ice);
  const shade = rgb(colors.shade);

  const uniforms = useDerivedValue(() => ({
    size: [size.value.width, size.value.height],
    time: reduced ? 4 : clock.value / 1000,
    bend: bent.value,
    columns: columns ? 1 : 0,
    green,
    ice,
    shade,
  }));

  if (!effect) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} onSize={size} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
