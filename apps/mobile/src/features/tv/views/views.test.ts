import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The rules that make My Stats, Challenges and Leaderboards navigable with a
 * Siri Remote, held by the build (docs/apple-tv.md, "Navigation").
 *
 * Every one of these was a screen the remote could not use: a page of Views
 * with nothing focusable on it (My Stats, Challenges), a guide aimed at a
 * Pressable that swallowed focus (the tab bar, builds 27 and 28), a list whose
 * every row re-rendered on every press. None of them fails a typecheck or a
 * phone; `scripts/perf/tv` (test12 to test14) walks them with the remote.
 */
const ROOT = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const VIEWS = ['TVStats', 'TVChallenges', 'TVLeaderboard'] as const;
const ROUTES: Record<(typeof VIEWS)[number], string> = {
  TVStats: 'app/(tabs)/stats.tsx',
  TVChallenges: 'app/(tabs)/challenges.tsx',
  TVLeaderboard: 'app/(tabs)/leaderboard.tsx',
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(full) && !/\.test\.ts$/.test(full)) out.push(full);
  }
  return out;
}

describe('the TV list-and-detail screens', () => {
  it('no focus guide anywhere is aimed at destinations', () => {
    // A guide's destinations must be native views. Aimed at our Pressable (an
    // animated component on a TV) the guide has nowhere to send focus and
    // takes it itself: an invisible block that Select does nothing on.
    const offenders = [...sources(resolve(ROOT, 'src')), ...sources(resolve(ROOT, 'app'))]
      .filter((file) => /destinations=|\.setDestinations\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('the list, the detail and each switcher are autoFocus guides', () => {
    const kit = read('src/features/tv/views/kit.tsx');
    const guides = [...kit.matchAll(/<TVFocusGuideView([^>]*)>/g)].map((m) => m[1]!);
    // The master column, the detail panel, and the switcher row.
    expect(guides.length).toBeGreaterThanOrEqual(3);
    for (const props of guides) expect(props).toMatch(/\bautoFocus\b/);
  });

  it('each tab hands a TV its own view, after every hook', () => {
    for (const view of VIEWS) {
      const route = read(ROUTES[view]);
      expect(route, ROUTES[view]).toMatch(new RegExp(`if \\(isTV[^)]*\\) \\{\\s*return \\(\\s*<Screen[^>]*>\\s*<${view}\\b`));
      // A hook after the early return is a hook that a TV does not call.
      const after = route.slice(route.indexOf(`<${view}`));
      const body = after.slice(0, after.indexOf('\nfunction ') === -1 ? undefined : after.indexOf('\nfunction '));
      expect(body, `${ROUTES[view]}: a hook after the TV return`).not.toMatch(/\buse[A-Z]\w*\(/);
    }
  });

  it('only the detail panel follows the focused row', () => {
    // The rows are memoised and never read the focused index; one component
    // subscribes. Otherwise every press re-renders the whole list.
    for (const view of VIEWS) {
      const source = read(`src/features/tv/views/${view}.tsx`);
      expect(source.match(/useTracked\(/g)?.length, view).toBe(1);
      expect(source, view).toMatch(/function Detail\([\s\S]*?useTracked\(track\)/);
    }
  });

  it('the list mounts the rows the remote can reach', () => {
    const kit = read('src/features/tv/views/kit.tsx');
    expect(kit).toMatch(/useTVRows\(items,/);
    expect(kit).toMatch(/items\.slice\(0, rows\.count\)/);
  });

  it('nothing the remote moves through clips, casts a shadow or draws Svg', () => {
    // Svg charts are the shared `charts` components, shown and hidden by
    // opacity (TVLayer) so they draw once, never per focus move.
    for (const file of ['kit', ...VIEWS]) {
      const source = read(`src/features/tv/views/${file}.tsx`);
      expect(source, file).not.toMatch(/from 'react-native-svg'/);
      expect(source, file).not.toMatch(/overflow: 'hidden'/);
      expect(source, file).not.toMatch(/shadow[A-Z]\w*:/);
      expect(source, file).not.toMatch(/elevate\(/);
    }
    const kit = read('src/features/tv/views/kit.tsx');
    expect(kit).toMatch(/opacity: shown \? 1 : 0/);
  });

  it('Menu in a detail panel goes back to the list, not out of the tab', () => {
    const kit = read('src/features/tv/views/kit.tsx');
    expect(kit).toMatch(/BackHandler\.addEventListener\('hardwareBackPress'/);
    expect(kit).toMatch(/useTVBack\(inDetail, back\)/);
  });
});
