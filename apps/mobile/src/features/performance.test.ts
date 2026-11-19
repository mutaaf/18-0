import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The phone's performance rules, held by the build (docs/performance.md).
 *
 * Each one was measured with `scripts/perf/phone/web.mjs` -- component
 * renders and main-thread time per step of a real season -- and each is the
 * kind of regression nothing else here sees: every screen still renders, every
 * test passes, and the play screen quietly does twice the work per spin.
 * The Apple TV's own rules are in `features/tv/performance.test.ts`.
 */
const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('phone performance (docs/performance.md)', () => {
  it('a player row paints its team wash as a gradient layer, not an Svg', () => {
    // Seven components a row (Svg, Defs, gradient, three stops, Rect) and a
    // CPU raster per row on iOS, for a list that is a whole spin long.
    const source = read('src/components/PlayerCard.tsx');
    expect(source).not.toMatch(/from 'react-native-svg'/);
    expect(source).toMatch(/washStyle\(teamColor, teamColor2\)/);
  });

  it('the rows grow inside their own component, not in the play screen', () => {
    // Every batch of rows re-rendered the whole screen -- header, hero, bar,
    // chips -- eight or nine times in the frames after the wheel stopped.
    const source = read('app/play.tsx');
    const play = source.slice(source.indexOf('export default function Play('), source.indexOf('function useStable'));
    expect(play).not.toMatch(/useGrowing\(/);
    expect(source).toMatch(/const PlayerList = memo\(function PlayerList\([\s\S]*?useGrowing\(isTV \? NO_ROWS : eligible\)/);
  });

  it('no screen subscribes to the whole game or history store', () => {
    // `useGameStore()` re-renders on every write: a session attaching, a spin,
    // a pick, a result stored. Select the fields the screen draws.
    for (const path of [
      'app/play.tsx',
      'app/result.tsx',
      'app/(tabs)/index.tsx',
      'app/(tabs)/games.tsx',
      'app/(tabs)/stats.tsx',
      'app/(tabs)/leaderboard.tsx',
      'app/(tabs)/challenges.tsx',
    ]) {
      const source = read(path);
      expect(source, path).not.toMatch(/useGameStore\(\)/);
      expect(source, path).not.toMatch(/useHistoryStore\(\)/);
    }
  });

  it('the front page strip under every game does not re-render with it', () => {
    // The front page stays mounted under the play screen and re-renders on
    // each pick; the marquee is thirty cards.
    expect(read('src/components/Hall.tsx')).toMatch(/export const Hall = memo\(/);
  });

  it('the result mounts its off-screen share card after the screen, not with it', () => {
    // A second roster drawn for the capture, in the one commit that puts the
    // result on the glass: the longest task of the season.
    const source = read('app/result.tsx');
    expect(source).toMatch(/\{captureMounted \? \(\s*<ShareCard/);
    expect(source).toMatch(/setTimeout\(\(\) => setCaptureDue\(true\), CUE\.digits\)/);
  });

  it('a slot’s landing sparks leave once they have flown', () => {
    // Left mounted, seven filled slots held seventy animated views that every
    // later spin and pick re-rendered.
    expect(read('src/components/Field.tsx')).toMatch(/setTimeout\(\(\) => setBurst\(null\), SPARK_MS/);
  });
});
