import { describe, expect, it } from 'vitest';
import { distribution, ring, trend, winColumns } from './geometry';

const BOX = { width: 300, height: 120 };

describe('distribution', () => {
  it('needs two ratings to draw a shape', () => {
    expect(distribution([], BOX)).toBeNull();
    expect(distribution([90], BOX)).toBeNull();
  });

  it('places every rating inside the box and the ridge on its baseline', () => {
    const d = distribution([88.2, 90.1, 90.4, 91, 93.7, 95.2], BOX)!;
    expect(d.area.startsWith('M')).toBe(true);
    for (const r of [88.2, 95.2, 50, 120]) {
      const x = d.x(r);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(BOX.width);
    }
    expect(d.baseline).toBeLessThanOrEqual(BOX.height);
  });
});

describe('trend', () => {
  it('finds the best and the latest season', () => {
    const t = trend([80, 92, 85, 88], BOX)!;
    expect(t.best.rating).toBe(92);
    expect(t.last.rating).toBe(88);
    expect(t.last.x).toBeGreaterThan(t.best.x);
    // Higher on screen is a smaller y.
    expect(t.best.y).toBeLessThan(t.last.y);
  });
});

describe('winColumns', () => {
  it('always draws all eighteen records, 0-17 to 17-0', () => {
    const cols = winColumns([12, 12, 13, 16], BOX);
    expect(cols).toHaveLength(18);
    expect(cols[12]!.count).toBe(2);
    expect(cols[17]!.count).toBe(0);
    expect(cols[17]!.height).toBe(0);
    // A single season is still visible next to a taller column.
    expect(cols[16]!.height).toBeGreaterThanOrEqual(2);
  });
});

describe('ring', () => {
  it('splits into one slice per mode that was played', () => {
    const slices = ring(
      [
        { key: 'rookie', count: 3 },
        { key: 'player_iq', count: 1 },
        { key: 'scout', count: 0 },
      ],
      80,
    );
    expect(slices.map((s) => s.key)).toEqual(['rookie', 'player_iq']);
    expect(slices[0]!.share).toBeCloseTo(0.75);
  });

  it('is empty with no seasons', () => {
    expect(ring([{ key: 'rookie', count: 0 }], 80)).toEqual([]);
  });
});
