import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bendOf, rgb } from './color';
import { buildShow } from './show';

const MOBILE = join(__dirname, '..', '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('the Skia boundary', () => {
  it('imports Skia only from effects/, which load after CanvasKit', () => {
    // On the web, evaluating @shopify/react-native-skia before CanvasKit has
    // loaded throws -- its web entry builds the API from global.CanvasKit at
    // import. A static import anywhere in the startup graph takes the whole
    // web app down, with nothing on screen to say why. See features/gpu/index.tsx.
    const offenders = [...sources(join(MOBILE, 'src')), ...sources(join(MOBILE, 'app'))]
      .filter((file) => !file.includes(join('features', 'gpu', 'effects')))
      .filter((file) => !file.endsWith('gpu.test.ts'))
      .filter((file) => /from ['"]@shopify\/react-native-skia['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(MOBILE, file));
    expect(offenders).toEqual([]);
  });

  it('reaches every effect through import(), never a static import', () => {
    const offenders = [...sources(join(MOBILE, 'src')), ...sources(join(MOBILE, 'app'))]
      .filter((file) => /from ['"][^'"]*gpu\/effects\//.test(readFileSync(file, 'utf8')))
      .map((file) => relative(MOBILE, file));
    expect(offenders).toEqual([]);
  });
});

describe('rgb', () => {
  it('reads a token as unit floats and ignores its alpha', () => {
    expect(rgb('#FF0000')).toEqual([1, 0, 0]);
    expect(rgb('#5FBB4633')).toEqual([0x5f / 255, 0xbb / 255, 0x46 / 255]);
  });
  it('refuses something that is not a token', () => {
    expect(() => rgb('green')).toThrow();
  });
});

describe('bendOf', () => {
  it('is 0 flat, deepest at a right angle, and never layout', () => {
    expect(bendOf({ angle: 120 }, false)).toBe(0);
    expect(bendOf({ angle: 90 }, true)).toBe(1);
    expect(bendOf({ angle: 170 }, true)).toBe(0.35);
    expect(bendOf(null, true)).toBe(0.7);
  });
});

describe('buildShow', () => {
  const box = { width: 951, height: 669, colors: 4 };
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  it('scales with the record: a flicker, a show, a finale', () => {
    const quiet = buildShow({ ...box, intensity: 0.2, perfect: false, origin: null, random });
    const big = buildShow({ ...box, intensity: 0.9, perfect: false, origin: null, random });
    const perfect = buildShow({ ...box, intensity: 1, perfect: true, origin: null, random });
    expect(quiet.shells).toHaveLength(0);
    expect(big.shells.length).toBeGreaterThan(quiet.shells.length);
    expect(perfect.shells.length).toBeGreaterThan(big.shells.length);
    expect(perfect.confetti.length).toBeGreaterThan(big.confetti.length);
    expect(big.confetti.length).toBeGreaterThan(quiet.confetti.length);
  });

  it('draws nothing for nothing, and ends on its own', () => {
    expect(buildShow({ ...box, intensity: 0, perfect: false, origin: null, random })).toEqual({ confetti: [], shells: [], duration: 0 });
    const show = buildShow({ ...box, intensity: 1, perfect: true, origin: null, random });
    expect(show.duration).toBeGreaterThan(2);
    expect(show.duration).toBeLessThanOrEqual(9);
  });

  it('launches out of a Duo fold and bursts over both pages', () => {
    const fold = { x: 475.5, y: 669 };
    const show = buildShow({ ...box, intensity: 1, perfect: true, origin: fold, random });
    expect(show.shells.every((s) => s.fromX === fold.x)).toBe(true);
    expect(show.shells.some((s) => s.x < fold.x)).toBe(true);
    expect(show.shells.some((s) => s.x > fold.x)).toBe(true);
    // Never off the edge of the window.
    expect(show.shells.every((s) => s.x >= box.width * 0.08 && s.x <= box.width * 0.92)).toBe(true);
  });
});
