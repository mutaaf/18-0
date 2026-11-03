import { describe, expect, it } from 'vitest';
import { MIN_PANEL, VIRTUAL_SEAM, computeSpread, divisionsFromSegments, type Division, type SpreadInput } from './spread';

/**
 * Every number here was read off a booted iPhone Duo simulator (Xcode 27.1,
 * iOS 27.1), not derived. If a future runtime moves them, these fail before a
 * gutter quietly lands on the crease.
 */
const BOOK_WINDOW = { width: 951, height: 669 };
const BOOK_INSETS = { top: 0, left: 0, bottom: 34, right: 84 };
const BOOK_FOLD: Division = { x: 455.5, y: 0, width: 40, height: 669, active: true };

const TABLETOP_WINDOW = { width: 669, height: 951 };
const TABLETOP_INSETS = { top: 82, left: 0, bottom: 34, right: 0 };
const TABLETOP_FOLD: Division = { x: 0, y: 455.5, width: 669, height: 40, active: true };

const full = (w: { width: number; height: number }) => ({ x: 0, y: 0, ...w });

const input = (over: Partial<SpreadInput>): SpreadInput => ({
  frame: full(BOOK_WINDOW),
  window: BOOK_WINDOW,
  insets: BOOK_INSETS,
  divisions: [],
  virtual: true,
  ...over,
});

describe('computeSpread on iPhone Duo', () => {
  it('splits a book exactly at the fold, not at the middle of the safe area', () => {
    const spread = computeSpread(input({ divisions: [BOOK_FOLD] }));
    expect(spread).toMatchObject({ kind: 'columns', source: 'fold', folded: true });
    if (spread.kind !== 'columns') throw new Error('unreachable');
    expect(spread.leading).toEqual({ start: 0, size: 455.5 });
    expect(spread.seam).toEqual({ start: 455.5, size: 40 });
    // The trailing panel stops at the 84 pt vertical bar.
    expect(spread.trailing).toEqual({ start: 495.5, size: 951 - 84 - 495.5 });
  });

  it('lays a flat device out the same as a book, unfolded', () => {
    const flat = computeSpread(input({ divisions: [{ ...BOOK_FOLD, active: false }] }));
    const book = computeSpread(input({ divisions: [BOOK_FOLD] }));
    expect(flat).toEqual({ ...book, folded: false });
  });

  it('puts tabletop content above the fold and controls below', () => {
    const spread = computeSpread(
      input({ frame: full(TABLETOP_WINDOW), window: TABLETOP_WINDOW, insets: TABLETOP_INSETS, divisions: [TABLETOP_FOLD] }),
    );
    expect(spread).toMatchObject({ kind: 'rows', source: 'fold', folded: true });
    if (spread.kind !== 'rows') throw new Error('unreachable');
    expect(spread.top).toEqual({ start: 82, size: 455.5 - 82 });
    expect(spread.bottom).toEqual({ start: 495.5, size: 951 - 34 - 495.5 });
  });

  it('is one column on the closed outer display', () => {
    const outer = { width: 466, height: 678 };
    expect(computeSpread(input({ frame: full(outer), window: outer, insets: { top: 0, left: 0, bottom: 34, right: 84 } }))).toEqual({
      kind: 'single',
    });
  });

  it('measures a container that does not start at the window origin', () => {
    // A tab scene that stops 104 pt short of the bottom for the dock.
    const spread = computeSpread(input({ frame: { x: 0, y: 0, width: 951, height: 565 }, divisions: [BOOK_FOLD] }));
    expect(spread.kind).toBe('columns');
  });

  it('refuses a panel too narrow to hold the field', () => {
    const lopsided: Division = { ...BOOK_FOLD, x: MIN_PANEL - 10 };
    const spread = computeSpread(input({ divisions: [lopsided], virtual: false }));
    expect(spread.kind).toBe('single');
  });
});

describe('the virtual seam', () => {
  it('splits a wide window down the middle of its content', () => {
    const desktop = { width: 1440, height: 900 };
    const spread = computeSpread(input({ frame: full(desktop), window: desktop, insets: { top: 0, left: 0, bottom: 0, right: 0 } }));
    expect(spread).toMatchObject({ kind: 'columns', source: 'virtual', folded: false });
    if (spread.kind !== 'columns') throw new Error('unreachable');
    expect(spread.seam.size).toBe(VIRTUAL_SEAM);
    expect(spread.leading.size).toBe(spread.trailing.size);
    // Capped and centred, not stretched across a 1440 window.
    expect(spread.leading.start + spread.leading.size + spread.seam.size + spread.trailing.size - spread.leading.start).toBe(1240);
    expect(spread.leading.start).toBe(100);
  });

  it('is offered to a screen still in its narrow column, so it can go full-bleed', () => {
    const window = { width: 951, height: 669 };
    const column = { x: 45.5, y: 0, width: 860, height: 565 };
    expect(computeSpread(input({ frame: column, window, insets: { top: 0, left: 0, bottom: 0, right: 0 } })).kind).toBe('columns');
  });

  it('is not offered when switched off, but a real fold still is', () => {
    const desktop = { width: 1440, height: 900 };
    expect(computeSpread(input({ frame: full(desktop), window: desktop, virtual: false })).kind).toBe('single');
    expect(computeSpread(input({ divisions: [BOOK_FOLD], virtual: false })).kind).toBe('columns');
  });

  it('is not offered to a phone or to the 620-point extension frame', () => {
    for (const size of [{ width: 393, height: 852 }, { width: 393, height: 620 }, { width: 1000, height: 480 }]) {
      expect(computeSpread(input({ frame: full(size), window: size, insets: { top: 0, left: 0, bottom: 0, right: 0 } })).kind).toBe('single');
    }
  });
});

describe('divisionsFromSegments', () => {
  it('turns two side-by-side segments into a vertical fold', () => {
    const [fold] = divisionsFromSegments([
      { x: 0, y: 0, width: 475.5, height: 669 },
      { x: 475.5, y: 0, width: 475.5, height: 669 },
    ]);
    // A zero-width gap is widened to the native band, centred on the crease.
    expect(fold).toEqual({ x: 455.5, y: 0, width: 40, height: 669, active: true });
  });

  it('turns two stacked segments into a horizontal fold, in any order', () => {
    const [fold] = divisionsFromSegments([
      { x: 0, y: 500, width: 669, height: 451 },
      { x: 0, y: 0, width: 669, height: 480 },
    ]);
    expect(fold).toEqual({ x: 0, y: 470, width: 669, height: 40, active: true });
  });

  it('reads one segment as no fold', () => {
    expect(divisionsFromSegments([{ x: 0, y: 0, width: 951, height: 669 }])).toEqual([]);
  });
});
