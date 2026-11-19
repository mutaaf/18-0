import { describe, expect, it, vi } from 'vitest';

// The real module reaches into react-native; the cache only needs get/set.
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  },
}));

const { cached, isFresh } = await import('./cache');

describe('cache freshness', () => {
  it('is fresh only between written and written + ttl', () => {
    expect(isFresh(1000, 1500, 1000)).toBe(true);
    expect(isFresh(1000, 2000, 1000)).toBe(false);
    // Written "in the future" by a clock that was wrong: refresh it.
    expect(isFresh(10_000, 1000, 1000)).toBe(false);
    expect(isFresh(Number.NaN, 1000, 1000)).toBe(false);
  });

  it('a malformed stored entry is a miss, so the network is asked', async () => {
    store.set('cache:v1:board', '{}');
    const load = vi.fn(async () => ['fresh']);
    const read = await cached('board', load);
    expect(load).toHaveBeenCalledOnce();
    expect(read.value).toEqual(['fresh']);
  });

  it('an entry from a clock set ahead is refreshed rather than trusted', async () => {
    store.set('cache:v1:ahead', JSON.stringify({ value: ['old'], at: Date.now() + 86_400_000 }));
    const load = vi.fn(async () => ['new']);
    const read = await cached('ahead', load, { ttl: 30_000 });
    // Something to show, so it is handed over while the refresh runs.
    expect(read).toEqual({ value: ['old'], stale: true });
    expect(load).toHaveBeenCalledOnce();
  });
});
