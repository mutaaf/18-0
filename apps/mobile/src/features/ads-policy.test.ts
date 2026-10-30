import { describe, expect, it } from 'vitest';
import { AD_SLOTS, BREAK_EVERY_MS, adsAllowed, breakDue } from './ads-policy';

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
    expect(AD_SLOTS).toBe('results:banner:menu,between-seasons:interstitial:menu');
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
