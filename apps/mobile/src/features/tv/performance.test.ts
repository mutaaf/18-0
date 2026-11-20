import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TV_FIRST_ROWS, TV_ROWS_AHEAD, wantsMoreRows } from './rows';
import { PLANS } from './lights-plan';

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

  it('the tab bar is an autoFocus guide, not one aimed at a Pressable', () => {
    // A guide's destinations must be native views; a Pressable on a TV is an
    // animated component, so the guide took focus itself and nothing in the
    // bar could be reached. The remote harness's test11_TabBar walks it.
    const bar = read('src/components/TVTabBar.tsx');
    expect(bar).toMatch(/<TVFocusGuideView autoFocus/);
    expect(bar).not.toMatch(/destinations=/);
  });

  it('the smoothness meter runs on a TV only in the window after a press', () => {
    const probe = read('src/features/tv/jank.ts');
    // Started inactive; switched on by a press and off when the window closes.
    expect(probe).toMatch(/\}, false\);/);
    expect(probe).toMatch(/frame\.setActive\(true\)/);
    expect(probe).toMatch(/frame\.setActive\(false\)/);
    expect(read('app/_layout.tsx')).toMatch(/useTVJankProbe\(\);/);
  });
  // The third pass (after #85): what was still mounted, rasterised or looping
  // that the remote did not need.

  it('a spin on a TV mounts the rows the remote can reach, not the whole spin', () => {
    // The phone's useGrowing mounts a hundred rows a dozen a frame, eight
    // commits of the play screen in the second the remote is first pressed.
    const play = read('app/play.tsx');
    expect(play).toMatch(/useGrowing\(isTV \? NO_ROWS : eligible\)/);
    expect(play).toMatch(/const mounted = isTV \? tvRows\.count : growing;/);
    expect(play).toMatch(/onFocusRow=\{isTV \? tvRows\.onRowFocus : undefined\}/);
    expect(read('src/components/PlayerCard.tsx')).toMatch(/onFocus=\{onFocusRow \? \(\) => onFocusRow\(index\) : undefined\}/);
  });

  it('the list asks for more rows before the remote can reach its end', () => {
    // A row the remote cannot reach is a player nobody can pick: the batch is
    // asked for while there are still TV_ROWS_AHEAD rows below the remote.
    expect(TV_FIRST_ROWS).toBeGreaterThan(TV_ROWS_AHEAD);
    expect(wantsMoreRows(0, TV_FIRST_ROWS, 100)).toBe(false);
    expect(wantsMoreRows(TV_FIRST_ROWS - TV_ROWS_AHEAD - 1, TV_FIRST_ROWS, 100)).toBe(false);
    expect(wantsMoreRows(TV_FIRST_ROWS - TV_ROWS_AHEAD, TV_FIRST_ROWS, 100)).toBe(true);
    expect(wantsMoreRows(TV_FIRST_ROWS - 1, TV_FIRST_ROWS, 100)).toBe(true);
    // Everything mounted: nothing more to ask for.
    expect(wantsMoreRows(99, 100, 100)).toBe(false);
    expect(wantsMoreRows(5, 8, 8)).toBe(false);
    // The row the remote is handed after a spin is always mounted, with room below it.
    expect(read('src/features/tv/rows.ts')).toMatch(/Math\.max\(n, firstWanted \+ TV_ROWS_AHEAD \+ 1\)/);
  });

  it('the broadcast graphics paint natively, and clip nothing to a rounded corner', () => {
    // A lower third wiped an Svg on over the list the remote was moving down;
    // the record's glow was a full-screen CPU raster as the record slammed in.
    for (const path of ['src/features/tv/hud/kit.tsx', 'src/features/tv/hud/BroadcastReveal.tsx']) {
      expect(read(path), path).not.toMatch(/from 'react-native-svg'/);
    }
    // Rounded clipping over animated content is an offscreen mask pass per frame.
    const kit = read('src/features/tv/hud/kit.tsx');
    const panel = kit.slice(kit.indexOf('    panel: {'), kit.indexOf('    },', kit.indexOf('    panel: {')));
    expect(panel).not.toMatch(/overflow: 'hidden'/);
  });

  it('the backdrop behind every screen is native gradients on a TV', () => {
    // A full-screen Svg, rasterised on the main thread by every screen that mounts.
    const screen = read('src/components/Screen.tsx');
    const tv = screen.slice(screen.indexOf('  if (isTV) {'), screen.indexOf('  return (', screen.indexOf('  if (isTV) {')));
    expect(tv).toMatch(/experimental_backgroundImage: tvLights\(\)/);
  });

  it("Gut Check's remote legend shows its swipe a few times, not for as long as the deck is open", () => {
    const rate = read('app/rate.tsx');
    const hint = rate.slice(rate.indexOf('function RemoteHint'), rate.indexOf('function RoundEnd'));
    expect(hint).toMatch(/HINT_SHOWINGS,/);
    expect(hint).not.toMatch(/-1,/);
  });
  // Stadium lights (docs/apple-tv.md, "Stadium lights"): the phone's are Skia;
  // the TV's are static native gradients moved with transform and opacity.

  it('broadcast mode is the TV default, and a stored off nobody chose follows it', () => {
    const prefs = read('src/features/tv/prefs.ts');
    expect(prefs).toMatch(/\.\.\.TV_PREFS_DEFAULTS,/);
    expect(prefs).toMatch(/merge: \(persisted, current\) => \(\{ \.\.\.current, \.\.\.restoreTVPrefs\(persisted\) \}\)/);
    expect(read('src/features/tv/TVSettings.tsx')).toMatch(/broadcastChosen: true/);
  });

  it('the TV lights use no Svg, no Skia, no shadow and no clip', () => {
    const source = read('src/features/tv/lights.tsx');
    expect(source).not.toMatch(/react-native-svg|react-native-skia|@\/features\/gpu/);
    expect(source).not.toMatch(/shadow\w*:/);
    expect(source).not.toMatch(/overflow:/);
    expect(source).toMatch(/experimental_backgroundImage/);
  });

  it('the TV lights animate transform and opacity only, on the UI thread', () => {
    const source = read('src/features/tv/lights.tsx');
    expect(source).not.toMatch(/from 'react-native';[\s\S]*\bAnimated\b[\s\S]*from 'react-native'/);
    expect(source).not.toMatch(/useFrameCallback|requestAnimationFrame|setInterval/);
    const styles = [...source.matchAll(/useAnimatedStyle\(\(\) => \(\{([\s\S]*?)\}\)\)/g)].map((m) => m[1]!);
    expect(styles.length).toBe(3);
    for (const body of styles) {
      const flat = body.replace(/\{[^{}]*\}/g, '').replace(/\[[^[\]]*\]/g, '');
      const keys = [...flat.matchAll(/(\w+):/g)].map((m) => m[1]!);
      expect(keys.filter((key) => key !== 'transform' && key !== 'opacity')).toEqual([]);
    }
  });

  it('a light show animates at most eight layers, ends, and never strobes past three a second', () => {
    for (const [name, plan] of Object.entries(PLANS)) {
      const layers = plan.beams.length + (plan.wash.length ? 1 : 0) + plan.bulbs.length;
      expect(layers, name).toBeLessThanOrEqual(8);
      expect(plan.tail, name).toBeLessThanOrEqual(6000);
      // WCAG 2.3.1: no more than three flashes in any one second.
      for (let i = 0; i < plan.wash.length; i++) {
        const within = plan.wash.filter((t) => t >= plan.wash[i]! && t < plan.wash[i]! + 1000);
        expect(within.length, name).toBeLessThanOrEqual(3);
      }
      // The wash never passes about a third of full strength (0.42 at its brightest stop).
      expect(plan.washPeak * 0.42, name).toBeLessThan(0.4);
    }
    const source = read('src/features/tv/lights.tsx');
    // Nothing loops forever: the only repeat is the held record's two sways.
    expect(source).not.toMatch(/withRepeat\([\s\S]{0,400}?-1,/);
    expect(source).toMatch(/if \(!isTV \|\| !on \|\| cue === null\) return null;/);
  });

  it('the TV lights are behind their flag, and Reduce Motion gets no sweep, pop or strobe', () => {
    const source = read('src/features/tv/lights.tsx');
    expect(source).toMatch(/useFlag\('tv_broadcast_lights'\)/);
    expect(source).toMatch(/const reduced = useReducedMotion\(\);/);
    expect(source).toMatch(/\{reduced\s*\? null/);
  });
});
