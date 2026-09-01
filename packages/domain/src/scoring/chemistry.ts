import type { ChemistryRule, ScoringConfig } from '../constants/config.js';
import { clamp } from '../util/math.js';
import type {
  ChemistryDetail,
  ChemistryLink,
  CompletedRoster,
  RosterSlot,
} from '../types.js';

/**
 * A rule fires only when every clause is satisfied by a *distinct* slot, so
 * one running back cannot be both the power back and the explosive back.
 *
 * Clause counts are tiny (<= 3), so exhaustive backtracking is the honest
 * implementation.
 */
function ruleFires(rule: ChemistryRule, roster: CompletedRoster): boolean {
  const used = new Set<RosterSlot>();

  const assign = (index: number): boolean => {
    const clause = rule.all[index];
    if (!clause) return true;
    for (const slot of clause.slots) {
      if (used.has(slot)) continue;
      if (!roster[slot].season.archetypes.includes(clause.archetype)) continue;
      used.add(slot);
      if (assign(index + 1)) return true;
      used.delete(slot);
    }
    return false;
  };

  return assign(0);
}

/**
 * Chemistry (PRFAQ §16). Bounded to [-1, +1] and never large enough to rescue
 * a materially weak roster.
 */
export function computeChemistry(
  roster: CompletedRoster,
  config: ScoringConfig,
): ChemistryDetail {
  const links: ChemistryLink[] = [];
  let raw = 0;

  for (const rule of config.chemistry.rules) {
    if (!ruleFires(rule, roster)) continue;
    links.push({ key: rule.key, label: rule.label, value: rule.value });
    raw += rule.value;
  }

  return {
    links,
    raw,
    bonus: clamp(raw, config.chemistry.min, config.chemistry.max),
  };
}
