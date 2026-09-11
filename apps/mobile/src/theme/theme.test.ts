import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEMES, THEME_LIST, type Palette } from './palettes';
import { __resetTheme, activeThemeId, color, radius, setTheme, themed } from './runtime';

/**
 * The rules a second theme depends on, asserted rather than remembered.
 *
 * Every one of these failed at least once while the second palette was being
 * built, and each failure was invisible in the theme that ships: a missing
 * token renders as `undefined` and React Native silently ignores it, a stray
 * `#0A0E17` looks perfect until the ground stops being black, and a stylesheet
 * that was not wrapped keeps whichever palette was loaded first with no error
 * anywhere. None of that is catchable by reading the diff. All of it is
 * catchable here.
 *
 * `environment: 'node'`, so this file may not import anything that reaches
 * react-native. That is why the store and the persistence are separate modules.
 */

const APP = process.cwd();

/** Every source file that is allowed to reference a colour. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full) && !full.endsWith('.test.ts')) out.push(full);
    }
  };
  walk(join(APP, 'src'));
  walk(join(APP, 'app'));
  // The theme module itself is where literals are supposed to live.
  return out.filter((f) => !f.includes(`${join('src', 'theme')}`));
}

/**
 * Whichever theme is not the shipped default.
 *
 * Named rather than hardcoded so these keep testing the switch rather than
 * testing that the default is Broadcast -- which is what they were doing, and
 * why they broke the day the default moved to Turf.
 */
const OTHER = THEME_LIST.find((t) => t.id !== DEFAULT_THEME)!;

afterEach(() => __resetTheme());

describe('palettes', () => {
  it('every theme declares exactly the same tokens', () => {
    // A key present in one palette and missing from the other resolves to
    // `undefined`, which React Native drops without complaint -- so the element
    // is simply unstyled in one theme and nobody finds out from a stack trace.
    const reference = Object.keys(THEMES[DEFAULT_THEME].color).sort();
    for (const theme of THEME_LIST) {
      expect(Object.keys(theme.color).sort(), `${theme.id} palette`).toEqual(reference);
    }
  });

  it('every token is a colour, not an empty string', () => {
    for (const theme of THEME_LIST) {
      for (const [token, value] of Object.entries(theme.color)) {
        expect(value, `${theme.id}.${token}`).toMatch(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
      }
    }
  });

  it('label text survives on the colour it sits on', () => {
    // The reason `onAction` exists. White on Broadcast's red is fine and white
    // on Turf's green is about 2.4:1, which is why a token named for a hue
    // could not have carried this.
    for (const theme of THEME_LIST) {
      const ratio = contrast(theme.color.onAction, theme.color.action);
      expect(ratio, `${theme.id}: onAction on action`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('body text survives on the ground', () => {
    for (const theme of THEME_LIST) {
      for (const token of ['text', 'silver', 'textDim'] as const) {
        const ratio = contrast(theme.color[token], theme.color.void);
        expect(ratio, `${theme.id}: ${token} on void`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('the live palette', () => {
  it('keeps its identity across a switch', () => {
    // Modules captured this object reference at import time. Reassigning the
    // export instead of replacing the contents would leave all of them looking
    // at the palette that is no longer active.
    const before = color;
    setTheme(OTHER.id);
    expect(color).toBe(before);
    expect(color.action).toBe(OTHER.color.action);
  });

  it('moves the shape scale too', () => {
    setTheme(OTHER.id);
    expect(radius.md).toBe(OTHER.radius.md);
    expect(radius.md).not.toBe(THEMES[DEFAULT_THEME].radius.md);
  });

  it('ignores an id it does not have', () => {
    setTheme('not-a-theme' as never);
    expect(activeThemeId()).toBe(DEFAULT_THEME);
  });
});


describe('themed()', () => {
  it('resolves to the active theme on every read', () => {
    const styles = themed(() => ({ root: { backgroundColor: color.void } }));

    expect(styles.root.backgroundColor).toBe(THEMES[DEFAULT_THEME].color.void);
    setTheme(OTHER.id);
    expect(styles.root.backgroundColor).toBe(OTHER.color.void);
  });

  it('builds each theme once', () => {
    let builds = 0;
    const styles = themed(() => {
      builds++;
      return { root: { backgroundColor: color.void } };
    });

    void styles.root;
    void styles.root;
    expect(builds).toBe(1);

    setTheme(OTHER.id);
    void styles.root;
    void styles.root;
    expect(builds).toBe(2);
  });

  it('survives being spread and enumerated', () => {
    // React Native flattens style objects, and a proxy that reports a
    // non-configurable descriptor its empty target does not have throws a
    // TypeError during that flattening rather than during the render that
    // caused it.
    const styles = themed(() => ({ a: { flex: 1 }, b: { flex: 2 } }));
    expect(Object.keys(styles).sort()).toEqual(['a', 'b']);
    expect({ ...styles }).toEqual({ a: { flex: 1 }, b: { flex: 2 } });
    expect('a' in styles).toBe(true);
  });
});

describe('the source tree', () => {
  it('wraps every module-scope stylesheet in themed()', () => {
    // The trap this whole design exists to close: `StyleSheet.create` at module
    // scope copies the palette's strings once, when the module is first
    // imported, and no amount of re-rendering will change them afterwards.
    const unwrapped = sourceFiles().filter((file) => {
      const src = readFileSync(file, 'utf8');
      return /^const styles = StyleSheet\.create\(/m.test(src);
    });
    expect(unwrapped.map((f) => relative(APP, f))).toEqual([]);
  });

  it('reaches for tokens rather than ground colours', () => {
    // Any near-black or deep-navy literal is a ground standing in for a token,
    // and it is exactly what stays black when the rest of the app turns navy.
    // White-alpha overlays are deliberately allowed: they are a lighting
    // effect, and they read correctly on any dark ground.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(/['"]#([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?['"]/g)) {
        // Perceived lightness. Anything this dark is a ground, not an accent.
        const luma = lightness(`#${match[1] ?? "000000"}`);
        if (luma < 0.14 && !isAllowed(file, match[0])) {
          offenders.push(`${relative(APP, file)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('subscribes every route to the palette', () => {
    // React Navigation hands a screen an element and memoizes it, so a theme
    // change re-renders only what *subscribes*. Nothing else in a screen can do
    // it on that screen's behalf: a wrapper like `Screen` re-rendering does not
    // reach `{children}`, because those elements were created by the route and
    // React bails out on an unchanged reference.
    //
    // Missing it looks exactly like it did the first time: a repainted theme
    // picker sitting inside a screen still wearing the old colours.
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx$/.test(full)) routes.push(full);
      }
    };
    walk(join(APP, 'app'));

    const missing = routes.filter((file) => {
      const src = readFileSync(file, 'utf8');
      if (!/^export default function/m.test(src)) return false;
      // The root layout subscribes through `useThemeFlagGuard`, which calls
      // `useThemeId` for its own reasons.
      if (file.endsWith(join('app', '_layout.tsx'))) return !/useThemeFlagGuard\(\)/.test(src);
      return !/\buseThemeId\(\)/.test(src);
    });

    expect(missing.map((f) => relative(APP, f))).toEqual([]);
  });

  it('never spells a token out by hand', () => {
    // The subtler half of the same mistake, and the one the lightness rule
    // above cannot see: `'#D50A0A14'` is not dark, it is a *wash of the action
    // colour* written as a literal. It looked right for as long as the action
    // colour was red, and left a maroon card sitting in the middle of a green
    // theme the moment it was not. Any literal equal to a token's value is that
    // token, written the one way that cannot follow the palette.
    //
    // White and black are the deliberate exceptions: `#FFFFFF0A` is a lighting
    // effect and `#00000033` is a shadow, and both read correctly on any ground.
    const tokens = new Map<string, string>();
    for (const [name, value] of Object.entries(THEMES[DEFAULT_THEME].color)) {
      const hex = value.slice(1, 7).toUpperCase();
      if (hex === 'FFFFFF' || hex === '000000') continue;
      if (!tokens.has(hex)) tokens.set(hex, name);
    }

    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(/['"]#([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?['"]/g)) {
        const token = tokens.get((match[1] ?? '').toUpperCase());
        if (token && !isAllowed(file, match[0])) {
          offenders.push(`${relative(APP, file)}: ${match[0]} is color.${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The literals that are genuinely not grounds.
 *
 * Kept as an explicit list rather than a pattern so adding one is a decision
 * somebody makes on purpose.
 */
function isAllowed(file: string, literal: string): boolean {
  const hex = literal.replace(/['"#]/g, '').toUpperCase();
  // Shadows are black in every theme; there is no such thing as a navy shadow.
  if (/^0{6}/.test(hex)) return true;
  // Apple's sign-in button is specified as near-black by Apple, and a green
  // one would fail their review rather than look clever.
  if (file.endsWith('ProviderButton.tsx')) return true;
  // The field graphic is grass. It is green in both themes because it is a
  // picture of a thing, not a surface.
  if (file.endsWith('Field.tsx')) return true;
  // Avatar grounds are generated per player to tell people apart; they are
  // identity, not decoration.
  if (file.endsWith('Avatar.tsx')) return true;
  return false;
}

/** The three channels of a `#RRGGBB`, 0-255. */
function channels(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** Rough perceived lightness, 0-1. Used only to spot a ground. */
function lightness(hex: string): number {
  const { r, g, b } = channels(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** WCAG relative luminance, then the standard ratio. */
function luminance(hex: string): number {
  const { r, g, b } = channels(hex);
  const linear = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string): number {
  const one = luminance(a);
  const two = luminance(b);
  const lighter = Math.max(one, two);
  const darker = Math.min(one, two);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Referenced so the `Palette` import is load-bearing rather than decorative. */
export type _Palette = Palette;
