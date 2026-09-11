/**
 * Where the seven slots go on the field.
 *
 * Pulled out of `Field.tsx` so it can be tested, because the bug it replaces
 * was arithmetic that nothing but one screenshot had ever checked.
 *
 * A slot used to be a flat 96pt dropped into a row padded 2pt off the field's
 * inner edge, and nothing measured the field at all. That 2pt plus the field's
 * own 8pt of padding was the whole of WR1's and WR2's clearance -- 10pt at
 * every width, against 130pt for the quarterback directly above them -- which
 * is why the receivers read as sitting on the touchline, and why a device
 * whose text or insets take a few points more than the browser's puts them
 * over it. Worse, the 10pt was bought by `flexShrink`: below about 360pt the
 * slots quietly shrank -- 70pt wide on a 300pt field, too narrow for the words
 * inside them -- so the size of a slot was decided by the screen rather than by
 * the field.
 *
 * Now the field is measured, the widest row divides it, and the clearance is a
 * named constant. `field-geometry.test.ts` sweeps every width the app supports.
 */
import { space } from '@/theme/tokens';

/**
 * How far a slot stays off the chalk, inside the field's own padding.
 *
 * The field is a pitch. A receiver whose box touches the touchline reads as a
 * rendering fault rather than a formation, and one that crosses it reads as a
 * player standing out of bounds.
 */
export const TOUCHLINE = space.md;

/** The space between two slots in the same row. */
export const GUTTER = space.sm;

/**
 * The widest row on the field -- WR1, TE1, WR2. It is the row that decides how
 * big a slot may be; every other row only ever spreads *further* in than it,
 * so sizing from this one keeps all seven inside the chalk.
 */
export const WIDEST_ROW = 3;

/** A slot never grows past this. Below it, it shrinks with the field. */
export const SLOT_WIDTH = 96;
export const SLOT_HEIGHT = 62;

export interface Formation {
  /** Every slot, the same width, whichever row it is in. */
  readonly slotWidth: number;
  /** Extra inset on the running-back row, on top of `TOUCHLINE`. */
  readonly backsInset: number;
}

/**
 * @param width  the formation's measured width, or 0 before it has laid out.
 * @param scale  the breakpoint's size multiplier — see `useLayout`.
 */
export function formation(width: number, scale: number): Formation {
  const cap = SLOT_WIDTH * scale;
  const inner = Math.max(0, width - TOUCHLINE * 2);
  // Unmeasured, a slot takes the cap; `flexShrink` on the slot itself covers
  // the one frame before `onLayout` reports.
  const slotWidth =
    inner === 0 ? cap : Math.max(0, Math.min(cap, (inner - GUTTER * (WIDEST_ROW - 1)) / WIDEST_ROW));
  // The backs sit inside the receivers. This was `18%` of the row, a fraction
  // of a width the slots themselves do not scale with, so the two rows drifted
  // apart as the screen narrowed. Now it is clamped to the room the two backs
  // actually leave, which is zero exactly when they need all of it.
  const backsInset = Math.min(inner * 0.18, Math.max(0, (inner - slotWidth * 2 - GUTTER) / 2));
  return { slotWidth, backsInset };
}
