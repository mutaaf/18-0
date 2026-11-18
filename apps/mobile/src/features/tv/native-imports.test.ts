import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Phone-only native modules are never imported statically.
 *
 * tvOS does not link these -- the TV has no Taptic Engine, pasteboard, share
 * sheet, notification centre or browser -- and each of them looks its native
 * module up the moment it is imported. One `import * as Haptics from
 * 'expo-haptics'` anywhere in the startup graph and the Apple TV app dies before
 * its first frame, while every phone build, typecheck and test stays green.
 * Nothing but a TV launch would notice, so this test is the thing that does.
 *
 * Each is reached through one module that checks `isTV` first and loads it
 * with `require()`/`import()` after the check. Type-only imports are fine.
 */
const ROOT = resolve(__dirname, '../../..');

const PHONE_ONLY: Record<string, readonly string[]> = {
  'expo-haptics': ['src/features/haptics.ts'],
  'expo-clipboard': ['src/features/clipboard.ts'],
  'expo-notifications': ['src/features/reminders.ts'],
  'expo-sharing': ['src/features/share.ts'],
  'expo-web-browser': ['src/services/auth.ts'],
  'react-native-view-shot': ['src/features/share.ts'],
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const files = [...sources(join(ROOT, 'app')), ...sources(join(ROOT, 'src'))].map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, 'utf8'),
}));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('phone-only native modules (docs/apple-tv.md)', () => {
  for (const [module, allowed] of Object.entries(PHONE_ONLY)) {
    it(`${module} is never imported statically`, () => {
      // `import x from 'm'`, `import * as x from 'm'`, `import {x} from 'm'`,
      // `import 'm'` and `export … from 'm'` -- but not `import type`.
      const pattern = new RegExp(
        `^\\s*(?:import(?!\\s+type\\b)[^;]*?from\\s*|import\\s*|export(?!\\s+type\\b)[^;]*?from\\s*)['"]${escape(module)}['"]`,
        'm',
      );
      const offenders = files.filter((f) => pattern.test(f.text)).map((f) => f.path);
      expect(offenders, `import it through ${allowed.join(', ')} instead`).toEqual([]);
    });

    it(`${module} is loaded lazily only where it is guarded`, () => {
      const lazy = new RegExp(`(?:require|import)\\(\\s*['"]${escape(module)}['"]\\s*\\)`);
      const loaders = files.filter((f) => lazy.test(f.text)).map((f) => f.path);
      expect(loaders.filter((path) => !allowed.includes(path))).toEqual([]);
    });
  }

  it('measures the window only through the stage', () => {
    // A TV lays the app out on a 1280 x 720 stage scaled to the glass
    // (TV_SCALE). React Native's own window size is the glass, half again too
    // big; only `useWindowSize` knows the difference.
    const allowed = ['src/theme/layout.ts'];
    const offenders = files
      .filter((f) => /\buseWindowDimensions\b|\bDimensions\.get\(/.test(f.text))
      .map((f) => f.path)
      .filter((path) => !allowed.includes(path));
    expect(offenders, 'use useWindowSize from @/theme').toEqual([]);
  });

  it("takes Pressable from the one that shows focus", () => {
    // React Native's own has no focus state on a TV, so a button imported
    // straight from it is one the remote can land on without anybody seeing.
    const offenders = files
      .filter((f) => f.path !== 'src/components/Pressable.tsx')
      .filter((f) => /import\s*\{[^}]*\bPressable\b(?!Props|State)[^}]*\}\s*from\s*'react-native'/.test(f.text))
      .map((f) => f.path);
    expect(offenders, "import { Pressable } from '@/components/Pressable'").toEqual([]);
  });

  it('converts every window measurement to the stage', () => {
    // measureInWindow answers on the glass, after the stage's scale; a layout
    // that mixes it with `useWindowSize` puts a TV's seam half again too far
    // right. Every call converts with `toStage` in the same file.
    const unconverted = files
      .filter((f) => /\bmeasureInWindow\(/.test(f.text) && !/\btoStage\(/.test(f.text))
      .map((f) => f.path);
    expect(unconverted).toEqual([]);
  });

  it('takes TextInput from the one that shows focus', () => {
    const offenders = files
      .filter((f) => f.path !== 'src/components/TextInput.tsx')
      .filter((f) => /import\s*\{[^}]*\bTextInput\b(?!Props)[^}]*\}\s*from\s*'react-native'/.test(f.text))
      .map((f) => f.path);
    expect(offenders, "import { TextInput } from '@/components/TextInput'").toEqual([]);
  });

  it('expo-audio is loaded only by the TV sound module', () => {
    // It links everywhere, but only a TV plays anything: a phone that loaded
    // it would set an audio session up for a game that makes no sound there.
    const any = /(?:from\s*|require\(\s*|import\(\s*)['"]expo-audio['"]/;
    const loaders = files.filter((f) => any.test(f.text)).map((f) => f.path);
    expect(loaders).toEqual(['src/features/tv/sound.ts']);
  });

  it('every sound cue has its file, and every file a cue', () => {
    // A cue whose .wav is missing fails in Metro, at bundle time, on a TV
    // build only; a .wav with no cue is weight nobody hears.
    const sound = files.find((f) => f.path === 'src/features/tv/sound.ts')!.text;
    const cues = [...sound.matchAll(/assets\/sounds\/tv\/([a-z]+)\.wav/g)].map((m) => m[1]).sort();
    const wavs = readdirSync(join(ROOT, 'assets/sounds/tv'))
      .filter((n) => n.endsWith('.wav'))
      .map((n) => n.replace(/\.wav$/, ''))
      .sort();
    expect(cues).toEqual(wavs);
  });

  it('the guarded loaders check for a television', () => {
    for (const path of new Set(Object.values(PHONE_ONLY).flat())) {
      const text = files.find((f) => f.path === path)?.text ?? '';
      expect(text, path).toMatch(/\bisTV\b/);
    }
  });
});
