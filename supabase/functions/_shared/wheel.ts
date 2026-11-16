/**
 * The wheel: every franchise-era a season may still be dealt.
 *
 * Shared by `spin` and `respin` so a paid respin is drawn from exactly the
 * candidates, by exactly the rule, a normal spin is -- the purchase sheet
 * states those odds, and "the same code" is the only way that statement stays
 * true after somebody edits one of them. The draw itself is `drawUniform` in
 * `packages/respins`, bundled into `respins.ts`.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { distinctBuckets } from './respins.ts';

export const ROSTER_SLOTS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1', 'DEF'] as const;
export type RosterSlot = (typeof ROSTER_SLOTS)[number];

export const SLOT_POSITION: Record<RosterSlot, string> = {
  QB: 'QB', RB1: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', TE1: 'TE', DEF: 'DEF',
};

/**
 * The ceiling has to sit above the whole live dataset, not near it.
 *
 * On the first spin of a game every position is open, so the query is "every
 * live card", ordered by rating. A cap below that count silently drops the
 * tail -- and because the order is by rating descending, what it drops is the
 * weakest cards, which are exactly the ones that make a thin franchise-era
 * spinnable at all. A bucket whose every card fell past the cut would simply
 * stop being offered, with nothing logged and nothing to notice.
 *
 * It was 4,000 and the dataset reached 4,872 when 1980-1998 came in. No
 * franchise-era lost its last card -- checked, the 4,000th row rated 71.82
 * and every bucket still had something above it -- so this was one era away
 * from being a real bug rather than a latent one.
 */
export const CANDIDATE_CEILING = 25_000;

export interface Candidate {
  readonly franchise_id: string;
  readonly era_key: string;
  readonly rating: number;
}

export type Wheel =
  | {
      ok: true;
      /** Every playable card, best first: the rigged spin takes the first. */
      candidates: Candidate[];
      /** The distinct franchise-eras among them: the fair spin draws one. */
      buckets: { franchiseId: string; era: string }[];
      truncated: boolean;
    }
  | { ok: false; reason: 'lookup_failed' | 'no_playable_spin'; detail?: string };

/**
 * Every franchise-era that still offers a playable card for an open slot.
 *
 * `selections` is what the season has picked; `gamedayFranchises` restricts
 * the wheel to the day's fixtures when the season is a gameday one.
 */
export async function readWheel(
  admin: SupabaseClient,
  selections: readonly { roster_slot: string; card_id: string }[],
  gamedayFranchises: readonly string[] | null,
): Promise<Wheel> {
  const filled = new Set(selections.map((s) => s.roster_slot));
  const openPositions = [...new Set(
    ROSTER_SLOTS.filter((slot) => !filled.has(slot)).map((slot) => SLOT_POSITION[slot]),
  )];
  if (openPositions.length === 0) return { ok: false, reason: 'no_playable_spin' };

  // Identities already on the roster cannot be offered again (PRFAQ §42).
  let usedEntities: string[] = [];
  if (selections.length > 0) {
    const { data: usedCards } = await admin
      .from('season_cards')
      .select('entity_id')
      .in('id', selections.map((s) => s.card_id));
    usedEntities = (usedCards ?? []).map((c) => c.entity_id as string);
  }

  let query = admin
    .from('season_cards')
    .select('franchise_id, era_key, rating')
    .in('position', openPositions)
    // A retired card is one a rebuilt dataset no longer contains. Its row stays
    // so the seasons played with it still resolve, but the wheel must never
    // deal it again -- the client's bundle has never heard of it (0020).
    .is('retired_at', null)
    .order('rating', { ascending: false });
  if (usedEntities.length > 0) query = query.not('entity_id', 'in', `(${usedEntities.join(',')})`);
  if (gamedayFranchises) query = query.in('franchise_id', [...gamedayFranchises]);

  const { data, error } = await query.limit(CANDIDATE_CEILING);
  if (error) return { ok: false, reason: 'lookup_failed', detail: error.message };
  const candidates = (data ?? []) as Candidate[];
  if (candidates.length === 0) return { ok: false, reason: 'no_playable_spin' };

  const buckets = distinctBuckets(
    candidates.map((c) => ({ franchiseId: c.franchise_id, era: c.era_key })),
  );
  return { ok: true, candidates, buckets, truncated: candidates.length === CANDIDATE_CEILING };
}
