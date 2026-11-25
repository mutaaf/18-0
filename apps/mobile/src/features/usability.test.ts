import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The usability rules (docs/performance.md, "Usability"), held by reading the
 * source tree, as theme.test.ts and performance.test.ts do. Each one is a dead
 * end that was found by walking the journeys (scripts/perf/phone/journeys.mjs,
 * test17_Journeys in scripts/perf/tv) and would come back silently.
 */
const APP = resolve(__dirname, '../../app');

function routes(dir: string = APP): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routes(path);
    return /\.tsx$/.test(name) && !name.startsWith('_') ? [relative(APP, path)] : [];
  });
}

/**
 * Routes that do not claim the remote, and why that is right. Anything not
 * here must say where the remote starts.
 */
const NO_INITIAL_FOCUS: Record<string, string> = {
  '(tabs)/games.tsx': 'a tab: the remote arrives from the tab bar, and down from it lands on the page',
  'embed.tsx': 'the frame inside another site; never on a TV',
  'admin.tsx': 'the operator console; never on a TV',
  'auth-callback.tsx': 'an OAuth redirect; a TV has no sign-in',
};

describe('every Apple TV screen says where the remote starts', () => {
  it.each(routes().filter((r) => !(r in NO_INITIAL_FOCUS)))('%s', (route) => {
    const source = readFileSync(join(APP, route), 'utf8');
    // A screen with no preferred focus leaves the remote wherever UIKit's
    // search lands: on a TV that was the tab bar, or nothing Select could use.
    expect(source).toMatch(/hasTVPreferredFocus|useTVInitialFocus|<TV(Home|Stats|Challenges|Leaderboard)\b/);
  });

  it('the exemptions are all still routes', () => {
    for (const route of Object.keys(NO_INITIAL_FOCUS)) expect(routes()).toContain(route);
  });
});

describe('a button says what it does', () => {
  it('no Play button is a bare "Play a season" or "Quick play"', () => {
    // Each of these started a lens without saying which; every generic Play
    // now names it (`playLabel`, state/next-season.ts).
    for (const route of routes()) {
      const source = readFileSync(join(APP, route), 'utf8');
      expect(source, route).not.toMatch(/['">]\s*(Quick play|Play a season|Start a season)\s*['"<]/);
    }
  });

  it('an empty My Stats starts a season rather than sending you to find one', () => {
    const source = readFileSync(join(APP, '(tabs)/stats.tsx'), 'utf8');
    expect(source).toContain('playNext()');
    expect(source).not.toMatch(/router\.push\('\/\(tabs\)'\)/);
  });
});
