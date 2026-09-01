import {
  ROSTER_SLOTS,
  SLOT_POSITION,
  type CompletedRoster,
  type PartialRoster,
  type RatedSeason,
  type RosterSlot,
  type SpinResult,
} from '../types.js';

export function openSlots(roster: PartialRoster): RosterSlot[] {
  return ROSTER_SLOTS.filter((slot) => roster[slot] === undefined);
}

export function filledSlotCount(roster: PartialRoster): number {
  return ROSTER_SLOTS.length - openSlots(roster).length;
}

export function isRosterComplete(roster: PartialRoster): roster is CompletedRoster {
  return openSlots(roster).length === 0;
}

/**
 * A unique historical identity may occupy only one roster slot (PRFAQ §42) —
 * different seasons of the same player do not unlock a second copy.
 */
export function rosterEntityIds(roster: PartialRoster): Set<string> {
  const ids = new Set<string>();
  for (const slot of ROSTER_SLOTS) {
    const selection = roster[slot];
    if (selection) ids.add(selection.season.entityId);
  }
  return ids;
}

/**
 * Which empty slots this card may legally fill. The UI must never hide whether
 * a selected player is assignable (PRFAQ §45).
 */
export function eligibleSlotsFor(season: RatedSeason, roster: PartialRoster): RosterSlot[] {
  if (rosterEntityIds(roster).has(season.entityId)) return [];
  return openSlots(roster).filter((slot) => SLOT_POSITION[slot] === season.position);
}

export type SelectionRejection =
  | 'SLOT_ALREADY_FILLED'
  | 'POSITION_MISMATCH'
  | 'DUPLICATE_ENTITY'
  | 'SPIN_MISMATCH';

export type SelectionValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SelectionRejection; readonly message: string };

/**
 * Server-side truth for a selection. The client mirrors this to grey out
 * illegal targets, but completion is validated here again (PRFAQ §36).
 */
export function validateSelection(input: {
  season: RatedSeason;
  slot: RosterSlot;
  roster: PartialRoster;
  spin: SpinResult;
}): SelectionValidation {
  const { season, slot, roster, spin } = input;

  if (roster[slot] !== undefined) {
    return { ok: false, reason: 'SLOT_ALREADY_FILLED', message: `${slot} is already filled.` };
  }
  if (SLOT_POSITION[slot] !== season.position) {
    return {
      ok: false,
      reason: 'POSITION_MISMATCH',
      message: `${season.displayName} is a ${season.position} and cannot fill ${slot}.`,
    };
  }
  if (rosterEntityIds(roster).has(season.entityId)) {
    return {
      ok: false,
      reason: 'DUPLICATE_ENTITY',
      message: `${season.displayName} is already on this roster.`,
    };
  }
  if (season.franchiseId !== spin.franchiseId || season.era !== spin.era) {
    return {
      ok: false,
      reason: 'SPIN_MISMATCH',
      message: `${season.displayName} is not eligible for this spin.`,
    };
  }

  return { ok: true };
}

/**
 * Dead-end guard (PRFAQ §6.3): if a spin offers nothing for any open slot the
 * user must be allowed to re-spin rather than being stuck.
 */
export function spinHasPlayableOption(
  eligible: readonly RatedSeason[],
  roster: PartialRoster,
): boolean {
  return eligible.some((season) => eligibleSlotsFor(season, roster).length > 0);
}
