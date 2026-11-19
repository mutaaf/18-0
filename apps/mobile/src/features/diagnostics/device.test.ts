import { describe, expect, it } from 'vitest';
import { SESSION_IDLE_MS, SessionClock, classifyDevice, uuidv7, webOsVersion } from './device-math';

describe('classifyDevice', () => {
  it('names each class', () => {
    expect(classifyDevice({ os: 'ios', isTV: true, isPad: false, shortSide: 1080 })).toBe('tv');
    expect(classifyDevice({ os: 'android', isTV: true, isPad: false, shortSide: 1080 })).toBe('tv');
    expect(classifyDevice({ os: 'web', isTV: false, isPad: false, shortSide: 1200 })).toBe('web');
    expect(classifyDevice({ os: 'ios', isTV: false, isPad: true, shortSide: 820 })).toBe('tablet');
    expect(classifyDevice({ os: 'ios', isTV: false, isPad: false, shortSide: 393 })).toBe('phone');
    expect(classifyDevice({ os: 'android', isTV: false, isPad: false, shortSide: 412 })).toBe('phone');
    expect(classifyDevice({ os: 'android', isTV: false, isPad: false, shortSide: 800 })).toBe('tablet');
  });
});

describe('webOsVersion', () => {
  it('reads a family and a major version, never more', () => {
    expect(webOsVersion('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15')).toBe('iOS 18');
    expect(webOsVersion('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36')).toBe('Android 15');
    expect(webOsVersion('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe('macOS');
    expect(webOsVersion('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
    expect(webOsVersion('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)')).toBe('ChromeOS');
    expect(webOsVersion('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
    expect(webOsVersion('curl/8')).toBe('other');
  });
});

describe('uuidv7', () => {
  const zeros = (n: number) => new Uint8Array(n);
  it('is a v7 UUID that carries its millisecond', () => {
    const at = Date.UTC(2026, 10, 18, 12, 0, 0);
    const id = uuidv7(at, zeros);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(at);
  });
});

describe('SessionClock', () => {
  let n = 0;
  const make = () => `s${++n}`;

  it('keeps a session through a short trip to the background', () => {
    const clock = new SessionClock(make, 0);
    const first = clock.current();
    clock.hide(1000);
    expect(clock.show(1000 + SESSION_IDLE_MS - 1)).toBe(false);
    expect(clock.current()).toBe(first);
  });

  it('starts a new one after half an hour away', () => {
    const clock = new SessionClock(make, 0);
    const first = clock.current();
    clock.hide(1000);
    clock.hide(5000); // a second hide (inactive, then background) keeps the first time
    expect(clock.show(1000 + SESSION_IDLE_MS)).toBe(true);
    expect(clock.current()).not.toBe(first);
  });

  it('does not rotate on an active it was already in', () => {
    const clock = new SessionClock(make, 0);
    const first = clock.current();
    expect(clock.show(10 * SESSION_IDLE_MS)).toBe(false);
    expect(clock.current()).toBe(first);
  });
});
