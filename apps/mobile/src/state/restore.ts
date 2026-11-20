import { ROSTER_SLOTS, type GameResult, type RosterSlot, type SpinResult } from '@17-0/domain';

/**
 * Reading saved state back without trusting it.
 *
 * zustand's `persist` spreads whatever JSON it finds over the store's defaults.
 * That is right for data this build wrote and wrong for everything else that
 * can be sitting in storage at launch: a game saved by an older build, a card
 * a later dataset retired, a write the OS cut off half way, a field a future
 * build renamed and this one is rolled back onto. Any of them reached the
 * screens as `selections.filter is not a function`, or as a roster whose
 * seventh card `lookupCard(...)!` could not find -- on the first render after
 * launch, every launch, which is an app that no longer opens.
 *
 * So each store reads through one of these instead of the default merge: keep
 * what is whole, drop what is not, and when an in-progress game cannot be
 * made consistent, put the player back at the start of a season rather than
 * in a state no button can leave. Pure, so `restore.test.ts` can throw every
 * kind of garbage at it.
 */

type GameMode = 'rookie' | 'scout' | 'player_iq' | 'gameday';
type GameStatus = 'idle' | 'ready_to_spin' | 'spun' | 'complete';

const MODES: readonly GameMode[] = ['rookie', 'scout', 'player_iq', 'gameday'];
const SLOTS = new Set<string>(ROSTER_SLOTS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoredSelection {
  readonly slot: RosterSlot;
  readonly cardId: string;
  readonly spinSequence: number;
}

export interface RestoredGame {
  status: GameStatus;
  spins: SpinResult[];
  selections: StoredSelection[];
  startedAt: number | null;
  result: GameResult | null;
  assisted: boolean;
  respinsUsed: number;
  mode: GameMode;
  gamedayKey: string | null;
  preferRanked: boolean;
  lensSnoozeUntil: number;
  ranked: boolean;
  serverSessionId: string | null;
  serverIdempotencyKey: string | null;
  serverNote: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** The parts of a result the screens and the stats actually read. */
export function isWholeResult(v: unknown): v is GameResult {
  if (!isObject(v)) return false;
  const record = v.record;
  const ending = v.ending;
  return (
    finite(v.finalRating) &&
    isObject(record) &&
    finite(record.wins) &&
    finite(record.losses) &&
    isObject(ending) &&
    str(ending.key) &&
    isObject(v.breakdown) &&
    isObject(v.perfectEligibility)
  );
}

/**
 * Where a game stands, from its spins and picks alone. The latest spin is
 * either spent (spin again) or still open (pick from it); seven picks is a
 * full roster. Used by the restore and by taking a refused pick back, which
 * used to leave the game asking for a spin while the server still held the
 * last one open -- and refused every spin after it.
 */
export function statusFrom(spins: readonly SpinResult[], selections: readonly StoredSelection[]): GameStatus {
  if (selections.length >= ROSTER_SLOTS.length) return 'complete';
  const latest = spins[spins.length - 1];
  if (!latest) return 'ready_to_spin';
  return selections.some((s) => s.spinSequence === latest.sequence) ? 'ready_to_spin' : 'spun';
}

/** play.tsx appends "This season will not be ranked." to whichever of these it shows. */
export const NOTE_CLOSED_BEFORE_OPENING = 'The app closed before the ranked game finished opening.';
export const NOTE_PICKS_DROPPED = 'A player from this season is no longer in the game and was taken off your roster.';

export function restoreGame(raw: unknown, knownCard: (id: string) => boolean, now: number = Date.now()): Partial<RestoredGame> {
  if (!isObject(raw)) return {};

  // Preferences survive whatever happened to the game itself.
  const prefs: Partial<RestoredGame> = {
    mode: MODES.includes(raw.mode as GameMode) ? (raw.mode as GameMode) : 'scout',
    preferRanked: typeof raw.preferRanked === 'boolean' ? raw.preferRanked : true,
    lensSnoozeUntil: finite(raw.lensSnoozeUntil) ? raw.lensSnoozeUntil : 0,
  };
  const fresh: Partial<RestoredGame> = {
    ...prefs,
    status: 'idle',
    spins: [],
    selections: [],
    startedAt: null,
    result: null,
    assisted: false,
    respinsUsed: 0,
    gamedayKey: null,
    ranked: false,
    serverSessionId: null,
    serverIdempotencyKey: null,
    serverNote: null,
  };

  if (raw.status === 'idle' || raw.status === undefined) return fresh;
  if (!Array.isArray(raw.spins) || !Array.isArray(raw.selections)) return fresh;

  // Spins must be whole and numbered 1, 2, 3...: the selection rules and the
  // server both count on the sequence. A gap cannot be repaired, only restarted.
  const spins: SpinResult[] = [];
  for (const [i, s] of raw.spins.entries()) {
    if (!isObject(s) || s.sequence !== i + 1 || !str(s.franchiseId) || !str(s.era)) return fresh;
    spins.push({ sequence: s.sequence, franchiseId: s.franchiseId, era: s.era as SpinResult['era'] });
  }

  const usedSlots = new Set<string>();
  const usedSpins = new Set<number>();
  const selections: StoredSelection[] = [];
  let dropped = false;
  for (const s of raw.selections) {
    if (
      !isObject(s) ||
      typeof s.slot !== 'string' ||
      !SLOTS.has(s.slot) ||
      !str(s.cardId) ||
      !finite(s.spinSequence) ||
      s.spinSequence < 1 ||
      s.spinSequence > spins.length ||
      usedSlots.has(s.slot) ||
      usedSpins.has(s.spinSequence)
    ) {
      return fresh;
    }
    // A card the current dataset retired. The rest of the roster is fine, so
    // only the pick goes; the slot opens and the next spin can fill it.
    if (!knownCard(s.cardId)) {
      dropped = true;
      continue;
    }
    usedSlots.add(s.slot);
    usedSpins.add(s.spinSequence);
    selections.push({ slot: s.slot as RosterSlot, cardId: s.cardId, spinSequence: s.spinSequence });
  }

  const status = statusFrom(spins, selections);
  const result = status === 'complete' && !dropped && isWholeResult(raw.result) ? raw.result : null;

  const sessionId = typeof raw.serverSessionId === 'string' && UUID.test(raw.serverSessionId) ? raw.serverSessionId : null;
  const key = typeof raw.serverIdempotencyKey === 'string' && raw.serverIdempotencyKey.length >= 8 ? raw.serverIdempotencyKey : null;
  const wasRanked = raw.ranked === true;
  // A ranked season resumes ranked when everything it needs came back. A
  // dropped pick is a roster the server holds and this device no longer
  // does, so that season carries on offline, and says so.
  const ranked = wasRanked && sessionId !== null && key !== null && !dropped;
  let serverNote = typeof raw.serverNote === 'string' ? raw.serverNote : null;
  if (wasRanked && !ranked) serverNote = dropped ? NOTE_PICKS_DROPPED : NOTE_CLOSED_BEFORE_OPENING;

  return {
    ...prefs,
    status,
    spins,
    selections,
    startedAt: finite(raw.startedAt) ? raw.startedAt : now,
    result,
    assisted: raw.assisted === true,
    respinsUsed: finite(raw.respinsUsed) && raw.respinsUsed > 0 ? Math.floor(raw.respinsUsed) : 0,
    gamedayKey: str(raw.gamedayKey) ? raw.gamedayKey : null,
    ranked,
    // A completed season keeps its session id when it has one: the result
    // screen's "show on the board" switch needs it after a relaunch.
    serverSessionId: ranked || (status === 'complete' && result && sessionId) ? sessionId : null,
    serverIdempotencyKey: ranked ? key : null,
    serverNote,
  };
}

// --- history -----------------------------------------------------------------

export interface RestoredPick {
  readonly slot: RosterSlot;
  readonly cardId: string;
  readonly name: string;
  readonly franchiseId: string;
  readonly era: string;
  readonly year: number;
  readonly rating: number;
}

const isWholePick = (p: unknown): p is RestoredPick =>
  isObject(p) &&
  typeof p.slot === 'string' &&
  SLOTS.has(p.slot) &&
  str(p.cardId) &&
  typeof p.name === 'string' &&
  str(p.franchiseId) &&
  str(p.era) &&
  finite(p.year) &&
  finite(p.rating);

/**
 * The finished seasons, keeping every one that is whole.
 *
 * One bad entry used to take the whole history down with it -- `computeStats`
 * reads `result.finalRating` off every game, so a single malformed row threw
 * on the Stats tab every time it opened. Now the bad row is the only thing
 * lost. A history is the one thing here a player cannot get back, so nothing
 * else about it is reset.
 */
export function restoreHistory<T>(raw: unknown): T[] {
  if (!isObject(raw) || !Array.isArray(raw.games)) return [];
  const out: T[] = [];
  for (const g of raw.games) {
    if (!isObject(g) || !str(g.id) || !finite(g.completedAt) || !isWholeResult(g.result) || !Array.isArray(g.roster)) {
      continue;
    }
    out.push({ ...g, roster: g.roster.filter(isWholePick) } as T);
  }
  return out.slice(0, 500);
}

/**
 * The Apple TV's preferences (`features/tv/prefs.ts`), as stored.
 *
 * `broadcastChosen` records that the person at the TV pressed the Broadcast
 * mode switch, so a later change to the default can tell a deliberate "off"
 * from a default nobody touched. Version 0 stores had no such marker.
 */
export interface StoredTVPrefs {
  sound: boolean;
  broadcast: boolean;
  broadcastChosen: boolean;
  cleanFeed: boolean;
  ticker: boolean;
}

export const TV_PREFS_VERSION = 1;

export const TV_PREFS_DEFAULTS: StoredTVPrefs = {
  sound: true,
  broadcast: true,
  broadcastChosen: false,
  cleanFeed: false,
  ticker: true,
};

/**
 * Bring an older store up to this version.
 *
 * Version 0 (before broadcast mode became the TV's default) stored
 * `broadcast: false` for everyone who never turned it on -- and for the few
 * who turned it on and off again, with nothing to tell the two apart. Nearly
 * every one of them is the first, so a version-0 "off" becomes on. A
 * version-0 "on" stays on, and counts as chosen.
 */
export function migrateTVPrefs(raw: unknown, version: number): unknown {
  if (!isObject(raw)) return raw;
  if (version < 1) {
    const chosen = raw.broadcast === true;
    return { ...raw, broadcast: true, broadcastChosen: chosen };
  }
  return raw;
}

/** Whatever is stored, as whole preferences: every key a boolean, or its default. */
export function restoreTVPrefs(raw: unknown): StoredTVPrefs {
  const out = { ...TV_PREFS_DEFAULTS };
  if (!isObject(raw)) return out;
  for (const key of Object.keys(out) as (keyof StoredTVPrefs)[]) {
    const value = raw[key];
    if (typeof value === 'boolean') out[key] = value;
  }
  // An "off" nobody chose is a default from before the default changed.
  if (!out.broadcastChosen) out.broadcast = TV_PREFS_DEFAULTS.broadcast;
  return out;
}
