import { describe, expect, it } from 'vitest';
import { DATASET } from '@17-0/data';
import { cardFromParam } from './card-param';

describe('a card deep link', () => {
  const card = DATASET.cards[0]!;

  it('finds the card from an encoded id, a plain id, or a repeated param', () => {
    expect(cardFromParam(encodeURIComponent(card.id))?.id).toBe(card.id);
    expect(cardFromParam(card.id)?.id).toBe(card.id);
    expect(cardFromParam([card.id, 'other'])?.id).toBe(card.id);
  });

  it('a stray % is "not in the dataset", not a thrown URIError', () => {
    expect(() => cardFromParam('50%')).not.toThrow();
    expect(cardFromParam('50%')).toBeUndefined();
    expect(cardFromParam('%E0%A4%A')).toBeUndefined();
  });

  it('nothing at all is nothing', () => {
    expect(cardFromParam(undefined)).toBeUndefined();
    expect(cardFromParam('')).toBeUndefined();
    expect(cardFromParam([])).toBeUndefined();
  });
});
