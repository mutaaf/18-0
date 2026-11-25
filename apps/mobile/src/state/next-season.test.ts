import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODE,
  ORDINARY_MODES,
  lastModeAfter,
  nextSeason,
  playLabel,
  restoreLastMode,
} from './next-season';
import { restoreGame } from './restore';

/**
 * "Clicking any play button should lead to the last game type to be started."
 * The rules are written in next-season.ts; these hold them.
 */
describe('what a generic Play starts', () => {
  it('is Scout, with the ranked switch on, before anything has been played', () => {
    expect(DEFAULT_MODE).toBe('scout');
    expect(nextSeason({ lastMode: DEFAULT_MODE, preferRanked: true })).toEqual({ mode: 'scout', ranked: true });
  });

  it('is the lens last started, from any button that names one', () => {
    let last = DEFAULT_MODE;
    last = lastModeAfter(last, 'player_iq');
    expect(nextSeason({ lastMode: last, preferRanked: true }).mode).toBe('player_iq');
    last = lastModeAfter(last, 'rookie');
    expect(nextSeason({ lastMode: last, preferRanked: false })).toEqual({ mode: 'rookie', ranked: false });
  });

  it('carries the ranked switch as the player left it', () => {
    expect(nextSeason({ lastMode: 'scout', preferRanked: false }).ranked).toBe(false);
  });

  it('never resolves to a gameday, which is open only inside its window', () => {
    for (const mode of ORDINARY_MODES) {
      expect(lastModeAfter(mode, 'gameday')).toBe(mode);
      expect(lastModeAfter(mode, 'gameday', 'gameday')).toBe(mode);
    }
  });

  it('never resolves to a challenge, which is somebody else’s one-off question', () => {
    expect(lastModeAfter('rookie', 'player_iq', 'challenge')).toBe('rookie');
    expect(lastModeAfter('scout', 'player_iq', 'challenge')).toBe('scout');
  });

  it('falls back to the default for a value no build wrote', () => {
    expect(nextSeason({ lastMode: 'gameday' as never, preferRanked: true }).mode).toBe('scout');
    expect(nextSeason({ lastMode: 'blind' as never, preferRanked: true }).mode).toBe('scout');
  });

  it('says on the button which lens it starts', () => {
    expect(playLabel('scout')).toBe('Play · Scout');
    expect(playLabel('player_iq')).toBe('Play · GM Mode');
    expect(playLabel('rookie', 'Build Another')).toBe('Build Another · Rookie');
  });
});

describe('the stored lastMode, at launch', () => {
  it('keeps a lens', () => {
    for (const mode of ORDINARY_MODES) expect(restoreLastMode({ lastMode: mode })).toBe(mode);
  });

  it('reads an older store’s mode, which is what its Play used to start', () => {
    expect(restoreLastMode({ mode: 'rookie' })).toBe('rookie');
    expect(restoreLastMode({ mode: 'gameday' })).toBe('scout');
  });

  it('drops garbage', () => {
    for (const lastMode of ['gameday', '', 7, null, {}, ['scout']]) {
      expect(restoreLastMode({ lastMode })).toBe('scout');
    }
  });

  it('survives whatever happened to the game itself', () => {
    expect(restoreGame({ status: 'idle', lastMode: 'player_iq' }, () => true).lastMode).toBe('player_iq');
    expect(restoreGame({ status: 'spun', spins: 'broken', lastMode: 'rookie' }, () => true).lastMode).toBe('rookie');
    expect(restoreGame({ status: 'idle', mode: 'gameday' }, () => true).lastMode).toBe('scout');
  });
});

/**
 * Every generic way in goes through `playNext`, so a new Play button that
 * hard-codes a lens -- which is how Games and the embed came to start Scout
 * whatever was played last -- fails here rather than in somebody's hand.
 */
describe('the generic Play buttons', () => {
  const APP = resolve(__dirname, '../../app');
  const read = (path: string) => readFileSync(resolve(APP, path), 'utf8');

  it.each([
    ['(tabs)/games.tsx'],
    ['(tabs)/stats.tsx'],
    ['result.tsx'],
  ])('%s starts the next season through playNext', (path) => {
    const source = read(path);
    expect(source).toContain('playNext(');
    // A lens named in a start call here would be a generic button ignoring the rule.
    expect(source).not.toMatch(/start\('(scout|rookie|player_iq)'/);
  });

  it('the front page’s Play and closer start the remembered lens, not a literal', () => {
    const source = read('(tabs)/index.tsx');
    expect(source).toContain('nextSeason(');
    expect(source.match(/start\(quickMode, \{ ranked \}\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('the embed starts the remembered lens, ranked (it has no switch to turn it back on)', () => {
    const source = read('embed.tsx');
    expect(source).toContain('start(next.mode)');
    expect(source).not.toMatch(/start\('(scout|rookie|player_iq)'/);
  });

  it('a challenge does not become the last mode', () => {
    expect(read('challenge.tsx')).toMatch(/startGame\('player_iq', \{[^}]*kind: 'challenge'/);
  });

  it('the play screen, opened with nothing under way, starts the remembered lens', () => {
    expect(read('play.tsx')).toContain('startGame(nextSeason(store).mode)');
  });
});
