import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AD_BANNER_RESERVE, AD_SLOTS, BREAK_EVERY_MS, SLOT_HOME, SLOT_RESULTS, adsAllowed, breakDue } from './ads-policy';

describe('where ads may run', () => {
  const web = { platform: 'web', embedded: false };

  it('the web build on the game\'s own addresses', () => {
    expect(adsAllowed({ ...web, hostname: '18-0.co' })).toBe(true);
    expect(adsAllowed({ ...web, hostname: 'mutaaf.github.io' })).toBe(true);
  });

  it('never in a native build, a frame, a preview or a dev server', () => {
    expect(adsAllowed({ platform: 'ios', embedded: false, hostname: '18-0.co' })).toBe(false);
    expect(adsAllowed({ platform: 'android', embedded: false, hostname: '18-0.co' })).toBe(false);
    expect(adsAllowed({ ...web, embedded: true, hostname: '18-0.co' })).toBe(false);
    expect(adsAllowed({ ...web, hostname: 'eighteen-zero-git-feat.vercel.app' })).toBe(false);
    expect(adsAllowed({ ...web, hostname: 'localhost' })).toBe(false);
  });

  it('declares every slot the app uses', () => {
    expect(AD_SLOTS).toBe('results:banner:menu,home:banner:menu,between-seasons:interstitial:menu');
  });
});

/**
 * Where each ad is placed, read off the source, because nothing else lays the
 * pages out: an ad on the play screen would pass every other test here while
 * it covered a spinning reel.
 */
describe('ads sit only on the pauses', () => {
  const APP = resolve(__dirname, '../../app');
  const COMPONENTS = resolve(__dirname, '../components');
  const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
  const usesAds = (source: string) => /<AdSlot\b|betweenSeasons\(|data-marquee/.test(source);

  it('the result screen carries the results banner, below Build Another and Share', () => {
    const source = read(APP, 'result.tsx');
    const slot = source.indexOf(`<AdSlot id={SLOT_RESULTS}`);
    expect(slot).toBeGreaterThan(source.indexOf('accessibilityLabel="Share this result"'));
    expect(slot).toBeGreaterThan(source.indexOf('accessibilityLabel="Build another roster"'));
    expect(SLOT_RESULTS).toBe('results');
  });

  it('the front page carries its banner at the foot, after every way into a season', () => {
    const source = read(APP, '(tabs)', 'index.tsx');
    const slot = source.indexOf(`<AdSlot id={SLOT_HOME}`);
    expect(slot).toBeGreaterThan(source.indexOf('{closer}'));
    expect(slot).toBeLessThan(source.indexOf('{footer}\n      </ScrollView>'));
    expect(SLOT_HOME).toBe('home');
  });

  it('only the result screen, the front page and the AdSlot itself touch an ad', () => {
    const users = [...walk(APP), ...walk(COMPONENTS)]
      .filter((path) => usesAds(read(path)))
      .map((path) => relative(resolve(__dirname, '../..'), path))
      .sort();
    expect(users).toEqual(['app/(tabs)/index.tsx', 'app/result.tsx', 'src/components/AdSlot.tsx']);
  });

  it('the break runs before the next season is started, never after', () => {
    const source = read(APP, 'result.tsx');
    const brk = source.indexOf('await betweenSeasons()');
    expect(brk).toBeGreaterThan(0);
    expect(brk).toBeLessThan(source.indexOf('game.startGame()', brk));
  });

  it('a banner holds its height while it loads, and lets `hidden` collapse it', () => {
    const source = read(COMPONENTS, 'AdSlot.tsx');
    expect(AD_BANNER_RESERVE).toBeGreaterThanOrEqual(90);
    expect(source).toContain('minHeight: AD_BANNER_RESERVE');
    // An inline display beats the `hidden` attribute and leaves an empty box.
    expect(source).not.toMatch(/display\s*:/);
  });
});

describe('the between-seasons break', () => {
  it('never interrupts the first season of a visit', () => {
    expect(breakDue({ seasonsThisVisit: 0, lastBreakAt: null }, 0)).toBe(false);
    expect(breakDue({ seasonsThisVisit: 1, lastBreakAt: null }, 0)).toBe(true);
  });

  it('runs at most once per window', () => {
    const at = 1_000_000;
    expect(breakDue({ seasonsThisVisit: 5, lastBreakAt: at }, at + BREAK_EVERY_MS - 1)).toBe(false);
    expect(breakDue({ seasonsThisVisit: 5, lastBreakAt: at }, at + BREAK_EVERY_MS)).toBe(true);
  });
});
