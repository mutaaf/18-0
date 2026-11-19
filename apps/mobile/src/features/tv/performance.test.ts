import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Apple TV performance budget, held by the build (docs/apple-tv.md,
 * "Performance").
 *
 * Each rule here is a measurement that was paid for once. The numbers are in
 * the doc; `scripts/perf/tv/run.sh` re-measures them. None of these mistakes
 * shows up in a typecheck, a unit test or a phone: they show up as a remote
 * that lags on an Apple TV HD, which nothing in CI owns.
 */
const ROOT = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('Apple TV performance (docs/apple-tv.md)', () => {
  it('Reanimated updates transform, opacity and shadows without a shadow-tree commit', () => {
    // Off by default in Reanimated 4. Every frame of every focus lift was a
    // commit and a Yoga layout of the whole screen -- a third of the main
    // thread while the remote moved down the play list, more the longer the
    // list. Read by the iOS podspec and the Android gradle build alike.
    const flags = JSON.parse(read('package.json')).reanimated?.staticFeatureFlags ?? {};
    expect(flags.IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS).toBe(true);
    expect(flags.ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS).toBe(true);
  });

  it('the focus language animates transform and opacity only', () => {
    // The synchronous path takes a view only when every prop it animates is on
    // Reanimated's list (ReanimatedModuleProxy.cpp, `synchronousPropNames`).
    // One layout prop -- a width, a margin, a `top` -- sends the view, and the
    // whole screen with it, back to a commit per frame.
    const source = read('src/components/Pressable.tsx');
    const styles = [...source.matchAll(/useAnimatedStyle\(\(\) => \(\{([\s\S]*?)\}\)\)/g)].map((m) => m[1]!);
    expect(styles.length).toBeGreaterThan(0);
    // Not shadows, either, though Reanimated can apply them without a commit:
    // on a real Apple TV an animated shadow with no shadowPath is an offscreen
    // render per frame. The simulator renders on the Mac's GPU and never showed
    // it; TestFlight build 23 on hardware did, as remote lag across the app.
    const allowed = new Set(['transform', 'opacity']);
    for (const body of styles) {
      // Top-level keys only: what is inside shadowOffset or a transform is not a prop.
      const flat = body.replace(/\{[^{}]*\}/g, '').replace(/\[[^[\]]*\]/g, '');
      const keys = [...flat.matchAll(/(\w+):/g)].map((m) => m[1]!);
      expect(keys.filter((key) => !allowed.has(key))).toEqual([]);
    }
  });

  it('a Pressable draws its focus only once it has been focused, and without Svg', () => {
    // A spin's list is a hundred Pressables. Each carried a rim and an Svg
    // sheen from mount -- eight native views per row, idle -- and every one of
    // them lengthened every commit of the screen.
    const source = read('src/components/Pressable.tsx');
    expect(source).not.toMatch(/from 'react-native-svg'/);
    expect(source).toMatch(/\{lit && visited \?/);
  });

  it('a player row on a TV paints its team wash natively, not with Svg', () => {
    const source = read('src/components/PlayerCard.tsx');
    const tv = source.slice(source.indexOf('if (isTV) {'), source.indexOf('\n  return (', source.indexOf('if (isTV) {')));
    expect(tv.length).toBeGreaterThan(0);
    expect(tv).not.toMatch(/<Svg\b/);
    expect(tv).toMatch(/experimental_backgroundImage/);
  });

  it('the React Compiler stays off: it would freeze the theme', () => {
    // babel-plugin-react-compiler caches JSX that reads only module-level
    // values behind a sentinel, forever. `color` is mutated in place by a theme
    // switch (docs/theming.md), so `style={{ color: color.text }}` compiled
    // once would keep the first theme's palette for the life of the app.
    expect(read('app.config.js')).not.toMatch(/reactCompiler/);
    expect(read('babel.config.js')).not.toMatch(/react-compiler/);
  });

  it('overlays over a page are ones the focus engine sees through', () => {
    // react-native-tvos answers YES to isUserInteractionEnabled on every
    // Fabric view, so a full-screen overlay with pointerEvents="none" still
    // counts as cover and the remote cannot reach anything beneath it. The
    // fireworks held the result screen for nine seconds; the broadcast HUD
    // sat over the whole play screen.
    for (const path of ['src/components/Celebration.tsx', 'src/features/tv/hud/PlayHud.tsx']) {
      const source = read(path);
      expect(source, path).toMatch(/passThroughView\(\)/);
      expect(source, path).toMatch(/<Overlay style=\{StyleSheet\.absoluteFill\}/);
    }
  });

  it('the pass-through view links on tvOS and is asked for on a TV only', () => {
    // No newer than the tvOS the app is built for (Expo's template: 16.4). It
    // once asked for 17.0, and CocoaPods left the pod out of the TV build
    // without an error -- the view was never there.
    expect(read('modules/pass-through/ios/PassThrough.podspec')).toMatch(/:tvos => '16\.4'/);
    const index = read('modules/pass-through/index.ts');
    // Android has no such view, and Fabric draws an unknown one as a magenta box.
    expect(index).toMatch(/Platform\.OS !== 'ios' \|\| !Platform\.isTV\) return \(resolved = View\)/);
    expect(read('modules/pass-through/ios/PassThroughModule.swift')).toMatch(/isUserInteractionEnabled: Bool \{\s*get \{ false \}/);
  });

  it('the row the remote is handed after a spin is not fading in', () => {
    // tvOS refuses hasTVPreferredFocus to a view at opacity 0. Inside a Reveal
    // the first row was, for a quarter of a second, and depending on timing
    // the remote landed on the "All" filter -- where Select does nothing.
    expect(read('src/components/PlayerCard.tsx')).toMatch(/immediate=\{preferFocus \|\|/);
  });

  it('a Reveal asks for Reduce Motion once for the app, not once per instance', () => {
    const source = read('src/components/Reveal.tsx');
    expect(source.match(/AccessibilityInfo\.isReduceMotionEnabled\(\)/g)).toHaveLength(1);
    expect(source).toMatch(/if \(reduced !== null\) return Promise\.resolve\(reduced\)/);
  });

  it('the front page under a game listens for whether one is under way, not its status', () => {
    // It stays mounted under every game; `status` moves three times a spin.
    const source = read('app/(tabs)/index.tsx');
    expect(source).not.toMatch(/status: s\.status/);
  });

  it('the shaders hold still on a TV', () => {
    // Drawn on the main thread tvOS also runs focus on, at 4K, by an A-series GPU.
    const source = read('src/features/gpu/clock.ts');
    expect(source).toMatch(/const STILL = isTV;/);
    expect(source).toMatch(/const running = !STILL &&/);
  });

  it('a focus move makes no sound and mounts no clipped sheen', () => {
    // A sound per remote press was an audio seek and play on the JS thread; a
    // sheen clipped to a rounded rim was a mask pass per frame on hardware.
    const source = read('src/components/Pressable.tsx');
    expect(source).not.toMatch(/cue\(/);
    expect(source).not.toMatch(/overflow: 'hidden'/);
    expect(source).not.toMatch(/experimental_backgroundImage/);
  });

  it('the sound effects load after launch, not in front of it', () => {
    const source = read('src/features/tv/sound.ts');
    expect(source).toMatch(/setTimeout\(next, 2500\)/);
  });

  // Build 26 (after #82) was better on an Apple TV and still stuttered. What
  // was left was CPU and offscreen GPU work, none of which the simulator shows.

  it('no Skia on a TV: every GPU effect is its fallback there', () => {
    expect(read('src/features/gpu/index.tsx')).toMatch(/if \(!on \|\| isTV\) return <>\{fallback\}<\/>;/);
  });

  it('no layer shadows on a TV, in any themed stylesheet', () => {
    const source = read('src/theme/runtime.ts');
    expect(source).toMatch(/const built = shadowless \? withoutShadows\(factory\(\)\) : factory\(\);/);
    expect(read('src/features/tv/platform.ts')).toMatch(/if \(isTV\) dropShadows\(\);/);
    // Inline ones are kept off by hand where a TV renders them.
    expect(read('src/components/Field.tsx')).not.toMatch(/&& \{ borderColor: accent, shadowColor/);
  });

  it('nothing the remote lands on repaints an Svg', () => {
    // react-native-svg rasterises on the CPU on the main thread. A tile whose
    // paint followed focus re-drew it in the middle of every lift.
    const home = read('src/features/tv/TVHome.tsx');
    expect(home).not.toMatch(/LinearGradient|RadialGradient/);
    expect(read('src/components/Panel.tsx')).toMatch(/isTV \?/);
    expect(read('src/components/GlassSurface.tsx')).toMatch(/if \(isTV\)/);
    expect(read('app/play.tsx')).toMatch(/team && isTV \?/);
  });

  it('the dock does not swell under the remote', () => {
    // Width is layout, so the swell ran on the JS driver: five tiles of JS and
    // Yoga per frame of every focus move.
    expect(read('src/components/Dock.tsx')).not.toMatch(/onFocus=\{isTV/);
  });

  it('screens out of sight stop rendering on a TV', () => {
    expect(read('app/_layout.tsx')).toMatch(/freezeOnBlur: isTV/);
    expect(read('app/(tabs)/_layout.tsx')).toMatch(/freezeOnBlur: isTV/);
  });

  it('a TV navigates from a tab bar across the top, not a dock or a rail', () => {
    expect(read('src/components/NavBar.tsx')).toMatch(/if \(isTV\) return <TVTabBar/);
    expect(read('src/features/fold/index.tsx')).toMatch(/if \(!enabled \|\| isTV\) return null;/);
    // Its focus look fades and scales two always-mounted views, nothing else.
    const bar = read('src/components/TVTabBar.tsx');
    const styles = [...bar.matchAll(/useAnimatedStyle\(\(\) => \(\{([\s\S]*?)\}\)\)/g)].map((m) => m[1]!);
    expect(styles.length).toBe(2);
    for (const style of styles) {
      const props = [...style.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
      expect(props.every((p) => p === 'opacity' || p === 'transform')).toBe(true);
    }
  });
});
