import { useCallback, useRef, useState } from 'react';

/** Rows a spin mounts with on a TV: more than a screen of them. */
export const TV_FIRST_ROWS = 12;
/** How far ahead of the remote the list stays mounted. */
export const TV_ROWS_AHEAD = 6;
/** How many rows arrive when the remote gets that close to the end. */
export const TV_ROWS_BATCH = 12;

/**
 * How many of a spin's rows a TV mounts: as far as the remote has been, and a
 * little further.
 *
 * A phone mounts the whole spin a dozen rows a frame (`useGrowing` in
 * app/play.tsx). On a TV those eight commits landed in exactly the second the
 * remote was first pressed after a spin, each one re-rendering the play screen
 * and laying out the scroll, and a hundred rows is a hundred focus targets the
 * focus engine searches on every press -- for a pick that is almost always made
 * in the first screen of them. So a TV mounts a screen and a half, and a row
 * taking focus within `TV_ROWS_AHEAD` of the end mounts the next batch. The
 * remote cannot outrun it: it is six presses from the last mounted row when
 * the next batch is asked for, and a batch is one commit.
 *
 * Not a FlatList: the rows share one scroll with the spin's hero, the scroll is
 * returned to its top when the hero collapses, and a virtualized list unmounts
 * rows the focus engine may still be holding. Nothing here ever unmounts.
 *
 * `firstWanted` is the row the remote is handed after a spin (`preferFocus`):
 * always mounted, however far down the first open player is.
 */
export function useTVRows(spin: readonly unknown[], firstWanted: number) {
  const [grown, setGrown] = useState<{ of: readonly unknown[]; n: number }>({ of: spin, n: TV_FIRST_ROWS });
  // Read synchronously, as useGrowing does: a new spin never inherits the last one's count.
  const n = grown.of === spin ? grown.n : TV_FIRST_ROWS;
  const count = Math.max(n, firstWanted + TV_ROWS_AHEAD + 1);
  const latest = useRef({ spin, count });
  latest.current = { spin, count };

  const onRowFocus = useCallback((index: number) => {
    const { spin: of, count: now } = latest.current;
    if (!wantsMoreRows(index, now, of.length)) return;
    setGrown({ of, n: now + TV_ROWS_BATCH });
  }, []);

  return { count, onRowFocus };
}

/** The pure rule, for the test: does focusing `index` with `count` mounted ask for more? */
export function wantsMoreRows(index: number, count: number, total: number): boolean {
  return index + TV_ROWS_AHEAD >= count && count < total;
}
