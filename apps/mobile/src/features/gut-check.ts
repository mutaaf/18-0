/**
 * Gut Check: ten cards, swipe right if the rating looks right, left if it does
 * not, then up or down for which way. The screen is `app/rate.tsx`; this is
 * the part without React Native, so it runs under the node test environment.
 *
 * Every swipe is a `rating_feedback` row (migrations 0025, 0028) with
 * `source: 'swipe'`, read by a person at the next refit and never by a score
 * (invariant 1). That is what shapes the deck: it is built to collect useful
 * evidence, not to be won.
 */

import type { RatingVerdict } from './rating-feedback-queue';

export const DECK_SIZE = 10;

/** At most this many of one position in a deck, so ten is never seven receivers. */
const PER_POSITION = 3;

/**
 * Cards the player has just drafted lead the deck. They are the ones a player
 * has an opinion of already, and the opinion is freshest straight after a
 * season -- but only a few, because a reviewer reading `source = 'swipe'`
 * wants strangers' cards too, not a second copy of the result screen.
 */
const FROM_HISTORY = 3;

/**
 * A part-time season makes a bad question: nobody remembers the back-up who
 * started four games, and "don't know" is a skip, not evidence. Defenses are a
 * whole season by construction.
 */
const MIN_GAMES = 10;

export interface DeckCard {
  readonly id: string;
  readonly position: string;
  readonly rating: number;
  readonly games: number;
}

export interface DeckInput<C extends DeckCard> {
  readonly pool: readonly C[];
  /** Card ids from the player's recent rosters, newest first. */
  readonly recent: readonly string[];
  /** True when this card already has the player's opinion under the current model. */
  readonly voted: (id: string) => boolean;
  /** [0, 1). Injected so a test can pin it; the deck has no reason to be reproducible. */
  readonly random?: () => number;
  readonly size?: number;
}

/**
 * How likely a card is to be drawn. Biased toward the top of the scale, where
 * people know the names and where a wrong number hurts most (the 97+ band is
 * what decides a perfect season), but never zero lower down: "this 74 is
 * underrated" is exactly the complaint players say they have.
 */
export function drawWeight(rating: number): number {
  const lift = Math.max(0, Math.min(rating, 100) - 60);
  return 1 + lift * lift;
}

export function buildDeck<C extends DeckCard>(input: DeckInput<C>): C[] {
  const size = input.size ?? DECK_SIZE;
  const random = input.random ?? Math.random;
  const byId = new Map(input.pool.map((c) => [c.id, c]));
  const deck: C[] = [];
  const taken = new Set<string>();
  const perPosition = new Map<string, number>();
  const fits = (c: C) =>
    !taken.has(c.id) && !input.voted(c.id) && (perPosition.get(c.position) ?? 0) < PER_POSITION;
  const take = (c: C) => {
    deck.push(c);
    taken.add(c.id);
    perPosition.set(c.position, (perPosition.get(c.position) ?? 0) + 1);
  };

  for (const id of input.recent) {
    if (deck.length >= Math.min(FROM_HISTORY, size)) break;
    const card = byId.get(id);
    if (card && fits(card)) take(card);
  }

  const eligible = input.pool.filter((c) => c.position === 'DEF' || c.games >= MIN_GAMES);
  // Weighted draws without replacement. A few thousand cards, ten draws: a
  // linear scan per draw is nothing, and it keeps the position cap exact.
  while (deck.length < size) {
    const open = eligible.filter(fits);
    if (open.length === 0) break;
    const total = open.reduce((sum, c) => sum + drawWeight(c.rating), 0);
    let at = random() * total;
    let pick = open[open.length - 1]!;
    for (const c of open) {
      at -= drawWeight(c.rating);
      if (at < 0) {
        pick = c;
        break;
      }
    }
    take(pick);
  }
  return deck;
}

export type Call = RatingVerdict | 'skip';

export interface RoundSummary {
  readonly fair: number;
  readonly tooHigh: number;
  readonly tooLow: number;
  readonly skipped: number;
  /** "Ratings nerd", "Tough grader"... one line that sums the round up. */
  readonly title: string;
  readonly line: string;
}

/** What the end card says. Playful, and true of the calls actually made. */
export function summarize(calls: readonly Call[]): RoundSummary {
  const n = (c: Call) => calls.filter((x) => x === c).length;
  const fair = n('fair');
  const tooHigh = n('too_high');
  const tooLow = n('too_low');
  const skipped = n('skip');
  const called = fair + tooHigh + tooLow;
  const base = { fair, tooHigh, tooLow, skipped };
  if (called === 0) return { ...base, title: 'Bye week', line: 'No calls this time. The cards will be here.' };
  if (fair === called) return { ...base, title: 'In sync', line: 'You and the model agree on all of them.' };
  if (tooHigh >= called * 0.6) return { ...base, title: 'Tough grader', line: 'You think the model is too generous.' };
  if (tooLow >= called * 0.6) return { ...base, title: 'Talent scout', line: 'You see more in these seasons than the model does.' };
  if (fair >= called * 0.7) return { ...base, title: 'Steady hand', line: 'Mostly fair, with a few you would move.' };
  return { ...base, title: 'Film room', line: 'You would move a few up and a few down.' };
}
