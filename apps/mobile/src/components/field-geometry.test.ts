import { describe, expect, it } from 'vitest';
import {
  GUTTER,
  SLOT_WIDTH,
  TOUCHLINE,
  WIDEST_ROW,
  formation,
} from './field-geometry';

/**
 * Every width the app can be handed: a 280pt phone in the largest accessibility
 * display size through the 620pt bounded column on the web, and the 480pt field
 * column a desktop window gives it. Sampled at 1pt, because the failure this
 * replaces was a slot that fitted at one width and hung over the chalk at the
 * next one.
 */
const WIDTHS = Array.from({ length: 400 }, (_, i) => 240 + i);
/** `useLayout`'s three breakpoints. */
const SCALES = [1, 1.2, 1.35];

describe('the formation stays inside the chalk', () => {
  it('never lets the widest row reach the touchline', () => {
    for (const scale of SCALES) {
      for (const width of WIDTHS) {
        const { slotWidth } = formation(width, scale);
        const row = slotWidth * WIDEST_ROW + GUTTER * (WIDEST_ROW - 1) + TOUCHLINE * 2;
        expect(
          row,
          `three slots of ${slotWidth} overflow a ${width}pt field at scale ${scale}`,
        ).toBeLessThanOrEqual(width + 0.001);
      }
    }
  });

  it('never lets the backs reach the touchline either', () => {
    for (const scale of SCALES) {
      for (const width of WIDTHS) {
        const { slotWidth, backsInset } = formation(width, scale);
        const row = slotWidth * 2 + GUTTER + (TOUCHLINE + backsInset) * 2;
        expect(
          row,
          `two backs of ${slotWidth} overflow a ${width}pt field at scale ${scale}`,
        ).toBeLessThanOrEqual(width + 0.001);
      }
    }
  });

  it('keeps the backs inside the receivers', () => {
    for (const scale of SCALES) {
      for (const width of WIDTHS) {
        expect(formation(width, scale).backsInset).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('gives a slot a width worth tapping, and never more than the cap', () => {
    for (const scale of SCALES) {
      for (const width of WIDTHS) {
        const { slotWidth } = formation(width, scale);
        expect(slotWidth).toBeGreaterThan(44);
        expect(slotWidth).toBeLessThanOrEqual(SLOT_WIDTH * scale);
      }
    }
  });

  it('grows with the field until it hits the cap, and never past it', () => {
    // A phone column of 345pt: the cap is what limits it, not the field.
    expect(formation(345, 1).slotWidth).toBe(SLOT_WIDTH);
    // A narrow one: the field is, and the slot shrinks rather than overflowing.
    expect(formation(240, 1).slotWidth).toBeLessThan(SLOT_WIDTH);
  });

  it('takes the cap before it has been measured', () => {
    expect(formation(0, 1).slotWidth).toBe(SLOT_WIDTH);
    expect(formation(0, 1.35).slotWidth).toBe(SLOT_WIDTH * 1.35);
  });
});
