/**
 * Where a screen may put two panels, and where it must not put anything.
 *
 * Pure: no React Native, so it runs under vitest with the numbers an iPhone
 * Duo simulator actually reported. Everything that decides a split lives here;
 * the provider only gathers inputs and the screens only read the answer.
 *
 * ---------------------------------------------------------------------------
 * The rules, and the device that made each one
 * ---------------------------------------------------------------------------
 *
 * **The fold is not in the middle of the safe area.** Open as a book, the
 * inner display is 951 x 669 pt with an 84 pt vertical bar on the trailing
 * edge, and the fold's band is 455.5-495.5. A split that halves the safe width
 * puts its gutter 42 pt to the leading side of the crease -- one column of the
 * field drawn across the hinge. So a real fold is used where it is, never
 * re-centred.
 *
 * **Flat and folded lay out the same.** A flat-open Duo reports its fold as an
 * *inactive* region at the same frame; only `active` flips when it bends. The
 * HIG asks for small adjustments while folding rather than rearrangement, so
 * an inactive fold still splits the screen -- the seam just loses its shadow.
 *
 * **Tabletop is a horizontal band.** Inner portrait folded at 90 deg reports
 * a 669 x 40 band at y 455.5: viewing content above, controls below.
 *
 * **No fold, wide window: a virtual seam.** The web cannot see the Duo's fold
 * unless Safari's experimental Viewport Segments flag is on, and a desktop has
 * none at all. Both still get the same two-panel composition, split down the
 * middle of the content, so the game is one game on every screen wide enough
 * to hold it rather than a Duo feature and a fallback.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Division extends Rect {
  /** A flat-open fold is reported, inactive. Folded, it is active. */
  readonly active: boolean;
}

export type HingeStatus = 'closed' | 'partiallyOpen' | 'fullyOpen' | 'unknown';

export interface Hinge {
  readonly status: HingeStatus;
  /** Degrees. Approximate, and for effects only -- never for layout. */
  readonly angle: number;
}

export interface Insets {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/** A span along one axis, in the container's own coordinates. */
export interface Band {
  readonly start: number;
  readonly size: number;
}

export type SeamSource = 'fold' | 'virtual';

export type Spread =
  | { readonly kind: 'single' }
  | {
      readonly kind: 'columns';
      readonly leading: Band;
      readonly seam: Band;
      readonly trailing: Band;
      readonly source: SeamSource;
      /** True while the device is bent at the seam -- a book, not a slab. */
      readonly folded: boolean;
    }
  | {
      readonly kind: 'rows';
      readonly top: Band;
      readonly seam: Band;
      readonly bottom: Band;
      readonly source: SeamSource;
      readonly folded: boolean;
    };

export const SINGLE: Spread = { kind: 'single' };

/**
 * The narrowest panel worth having. The field's widest row is three 96 pt
 * slots and their gutters; below about this a panel holds a squeezed phone
 * layout, which is worse than one honest column.
 */
export const MIN_PANEL = 300;

/** A virtual seam is as wide as the Duo's fold band, so both read the same. */
export const VIRTUAL_SEAM = 40;

/** The window has to be at least this wide before a virtual split is offered. */
export const VIRTUAL_MIN_WIDTH = 900;
export const VIRTUAL_MIN_HEIGHT = 520;

/** A spread never grows past this; a desktop gets two panels, not two acres. */
export const VIRTUAL_MAX_WIDTH = 1240;

export interface SpreadInput {
  /** The container, in window coordinates. */
  readonly frame: Rect;
  readonly window: { readonly width: number; readonly height: number };
  /** Safe-area insets of the window. */
  readonly insets: Insets;
  /** Folds in window coordinates, from the native sensor or the web. */
  readonly divisions: readonly Division[];
  /** Off means a fold is still honoured but no virtual seam is invented. */
  readonly virtual: boolean;
}

export function computeSpread(input: SpreadInput): Spread {
  const { frame, window, insets, divisions } = input;
  if (frame.width <= 0 || frame.height <= 0) return SINGLE;

  // The container's own safe span: the window's insets, but only where the
  // container actually reaches the window's edge. A tab scene that stops short
  // of the dock has no business clearing the home indicator twice.
  const safeLeft = Math.max(insets.left - frame.x, 0);
  const safeRight = Math.max(frame.x + frame.width - (window.width - insets.right), 0);
  const safeTop = Math.max(insets.top - frame.y, 0);
  const safeBottom = Math.max(frame.y + frame.height - (window.height - insets.bottom), 0);
  const left = safeLeft;
  const right = frame.width - safeRight;
  const top = safeTop;
  const bottom = frame.height - safeBottom;

  // Pick by shape, not by array position: the order is undocumented.
  const vertical = divisions.find((d) => d.height > d.width && spans(d.height, frame.height));
  if (vertical) {
    const start = vertical.x - frame.x;
    const end = start + vertical.width;
    const leading = { start: left, size: start - left };
    const trailing = { start: end, size: right - end };
    if (leading.size >= MIN_PANEL && trailing.size >= MIN_PANEL) {
      return {
        kind: 'columns',
        leading,
        seam: { start, size: vertical.width },
        trailing,
        source: 'fold',
        folded: vertical.active,
      };
    }
  }

  const horizontal = divisions.find((d) => d.width > d.height && spans(d.width, frame.width));
  if (horizontal) {
    const start = horizontal.y - frame.y;
    const end = start + horizontal.height;
    const upper = { start: top, size: start - top };
    const lower = { start: end, size: bottom - end };
    if (upper.size >= MIN_PANEL && lower.size >= MIN_PANEL) {
      return {
        kind: 'rows',
        top: upper,
        seam: { start, size: horizontal.height },
        bottom: lower,
        source: 'fold',
        folded: horizontal.active,
      };
    }
  }

  if (!input.virtual) return SINGLE;
  const usable = right - left;
  // The window decides whether a virtual seam is offered, not the container:
  // a screen that has not gone full-bleed yet is still sitting in its own
  // narrow column, and measuring that would keep it there forever.
  if (window.width < VIRTUAL_MIN_WIDTH || bottom - top < VIRTUAL_MIN_HEIGHT || usable < 2 * MIN_PANEL + VIRTUAL_SEAM) {
    return SINGLE;
  }
  const width = Math.min(usable, VIRTUAL_MAX_WIDTH);
  const origin = left + (usable - width) / 2;
  const panel = (width - VIRTUAL_SEAM) / 2;
  return {
    kind: 'columns',
    leading: { start: origin, size: panel },
    seam: { start: origin + panel, size: VIRTUAL_SEAM },
    trailing: { start: origin + panel + VIRTUAL_SEAM, size: panel },
    source: 'virtual',
    folded: false,
  };
}

/** A fold that does not cross most of the container is not this container's fold. */
function spans(length: number, container: number): boolean {
  return length >= container * 0.8;
}

/**
 * Viewport segments (the web's view of a fold) as divisions.
 *
 * Two side-by-side segments mean a vertical fold between them; two stacked
 * ones a horizontal fold. Safari reports segments only while the device is
 * bent -- flat is one segment -- so every division made here is active. A
 * zero-width gap is widened to the Duo's 40 pt band, centred, so the seam a
 * browser draws matches the one the app draws.
 */
export function divisionsFromSegments(
  segments: readonly Rect[],
): Division[] {
  if (segments.length !== 2) return [];
  const [a, b] = [...segments].sort((p, q) => p.x - q.x || p.y - q.y) as [Rect, Rect];
  const widen = (start: number, gap: number) => {
    const size = Math.max(gap, VIRTUAL_SEAM);
    return { start: start + gap / 2 - size / 2, size };
  };
  if (b.x >= a.x + a.width - 1) {
    const gap = Math.max(b.x - (a.x + a.width), 0);
    const band = widen(a.x + a.width, gap);
    return [{ x: band.start, y: 0, width: band.size, height: Math.max(a.height, b.height), active: true }];
  }
  if (b.y >= a.y + a.height - 1) {
    const gap = Math.max(b.y - (a.y + a.height), 0);
    const band = widen(a.y + a.height, gap);
    return [{ x: 0, y: band.start, width: Math.max(a.width, b.width), height: band.size, active: true }];
  }
  return [];
}

/**
 * The width of the vertical bar column: what an iPhone Duo reserves on the
 * trailing edge for its status bar and every system bar, open as a book.
 */
export const RAIL_WIDTH = 84;

export interface Rail {
  /** The rail's width, measured in from the window's trailing edge. */
  readonly width: number;
  /**
   * How much of that width the safe area does not already hold. Zero on a
   * Duo, where the rail lives in the vertical bar's own column. On a wide
   * web window, which has no such column, it is all of it, and the screens
   * have to stop short by that much.
   */
  readonly reserve: number;
}

/**
 * Where the navigation goes when the app is showing two pages.
 *
 * Apple moves the system tab bar on iPhone Duo to a vertical bar on the
 * trailing edge of the open display, sharing the 84 pt column with the status
 * bar, and says a custom tab bar has to get there on its own: nothing moves
 * it. Ours sat across the bottom of both pages instead, under one of them and
 * beside the fold. So whenever the window is a spread -- the Duo open flat or
 * as a book, or a browser window wide enough for the virtual seam -- the
 * navigation is a rail in that column. One page of a phone gets the phone's
 * bar, which is the other thing the HIG asks for: open portrait keeps
 * horizontal bars.
 */
export function navRail(input: Omit<SpreadInput, 'frame'>): Rail | null {
  const spread = computeSpread({ ...input, frame: { x: 0, y: 0, ...input.window } });
  if (spread.kind !== 'columns') return null;
  const width = Math.max(input.insets.right, RAIL_WIDTH);
  return { width, reserve: width - input.insets.right };
}
