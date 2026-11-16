import { describe, expect, it } from 'vitest';
import { LENS_SNOOZE, suggestLens, type LensSeason } from './lens';

const seasons = (mode: string, ...wins: number[]): LensSeason[] => wins.map((w) => ({ mode, wins: w }));

describe('which lens to suggest', () => {
  it('says nothing until it has seen a few seasons in this lens', () => {
    expect(suggestLens(seasons('scout', 15, 16), 'scout', 2)).toBeNull();
  });

  it('offers GM Mode to a player clearing Scout', () => {
    expect(suggestLens(seasons('scout', 13, 12, 14), 'scout', 3)).toMatchObject({ to: 'player_iq', direction: 'up' });
  });

  it('offers Rookie to a player struggling in Scout', () => {
    expect(suggestLens(seasons('scout', 5, 6, 4, 7), 'scout', 4)).toMatchObject({ to: 'rookie', direction: 'down' });
  });

  it('a typical Scout season suggests nothing', () => {
    expect(suggestLens(seasons('scout', 8, 9, 10, 7, 9), 'scout', 5)).toBeNull();
  });

  it('moves one step at a time: Rookie up to Scout, GM Mode down to Scout', () => {
    expect(suggestLens(seasons('rookie', 12, 11, 13), 'rookie', 3)?.to).toBe('scout');
    expect(suggestLens(seasons('player_iq', 5, 6, 7), 'player_iq', 3)?.to).toBe('scout');
  });

  it('has nowhere further to send the ends', () => {
    expect(suggestLens(seasons('player_iq', 16, 17, 15), 'player_iq', 3)).toBeNull();
    expect(suggestLens(seasons('rookie', 2, 3, 1), 'rookie', 3)).toBeNull();
  });

  it('reads only the lens the player is in, and only honest seasons', () => {
    const mixed: LensSeason[] = [
      { mode: 'scout', wins: 14, assisted: true },
      { mode: 'rookie', wins: 16 },
      ...seasons('scout', 9, 8, 9),
    ];
    expect(suggestLens(mixed, 'scout', 5)).toBeNull();
  });

  it('reads the recent seasons, so an old run of bad ones stops counting', () => {
    const history = [...seasons('scout', 13, 12, 13, 12, 13), ...seasons('scout', 2, 3, 2)];
    expect(suggestLens(history, 'scout', 8)?.to).toBe('player_iq');
  });

  it('waits when the season just played contradicts the trend', () => {
    expect(suggestLens(seasons('scout', 1, 15, 15, 15, 15), 'scout', 5)).toBeNull();
    expect(suggestLens(seasons('scout', 12, 2, 3, 2, 3), 'scout', 5)).toBeNull();
  });

  it('stays quiet after "Not now" until enough seasons have passed', () => {
    const history = seasons('scout', 13, 12, 14);
    expect(suggestLens(history, 'scout', 3, 3 + LENS_SNOOZE)).toBeNull();
    expect(suggestLens(history, 'scout', 3 + LENS_SNOOZE, 3 + LENS_SNOOZE)?.to).toBe('player_iq');
  });
});
