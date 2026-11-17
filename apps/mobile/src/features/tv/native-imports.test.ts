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

  it('the guarded loaders check for a television', () => {
    for (const path of new Set(Object.values(PHONE_ONLY).flat())) {
      const text = files.find((f) => f.path === path)?.text ?? '';
      expect(text, path).toMatch(/\bisTV\b/);
    }
  });
});
