import { describe, expect, it } from 'vitest';
import { fitsFirst } from './play-order';

describe('the spin list', () => {
  const rows = [
    { id: 'def', position: 'DEF' },
    { id: 'qb1', position: 'QB' },
    { id: 'qb2', position: 'QB' },
    { id: 'rb', position: 'RB' },
    { id: 'te', position: 'TE' },
  ];

  it('puts the players who can still go somewhere first, keeping each group in order', () => {
    expect(fitsFirst(rows, new Set(['RB', 'TE'])).map((r) => r.id)).toEqual(['rb', 'te', 'def', 'qb1', 'qb2']);
  });

  it('changes nothing while every position is open', () => {
    expect(fitsFirst(rows, new Set(['DEF', 'QB', 'RB', 'TE']))).toEqual(rows);
  });

  it('loses no row', () => {
    expect(fitsFirst(rows, new Set())).toHaveLength(rows.length);
  });
});
