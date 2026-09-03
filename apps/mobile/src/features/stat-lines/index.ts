import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { DATASET, cardById, type BootCard, type StatLine } from '@18-0/data';
import { parseManifest, parseStatLines, type ParsedStatLines } from './parse';

export * from './parse';

/**
 * Correcting a stat line without shipping an app.
 *
 * Everything a card shows is bundled, which is what lets the game work with no
 * account and no connection. The cost is that a *display* mistake ships on the
 * app's release cadence, and that cost was paid twice in one afternoon: every
 * pre-1999 defence showed `— SACK`, and every running back showed its yards
 * under the label `RUSH` with its carries nowhere at all. Both were fixed in
 * the repository within the hour. Neither could reach a phone.
 *
 * So the build publishes the stat lines as a static file beside the ledger, and
 * a build that is behind adopts them. Three properties make that safe enough to
 * be worth it:
 *
 * **It cannot change a result.** The payload is pairs of strings matched to
 * cards the bundle already has. Ratings come from the bundle for a preview and
 * from Postgres for anything that reaches a leaderboard, and neither is
 * reachable from here.
 *
 * **The bundle is still the answer.** Nothing waits for this, nothing fails
 * without it, and a device that never reaches the network behaves exactly as it
 * did before the feature existed.
 *
 * **The current case is nearly free.** A fresh install reads a 77-byte
 * manifest, sees its own revision, and stops. Only a stale build pays for the
 * 347 KB table, and only once per revision.
 */

const STORAGE_KEY = '18-0:stat-lines';

/**
 * Where the published table lives.
 *
 * On the web it is the same deploy serving the app, so an origin-relative path
 * built from the same base URL the bundle was exported with -- a relative
 * `./` would resolve against whatever route the player happens to be on.
 * Natively there is no origin, so it is the published site unless something
 * points it elsewhere.
 */
const BASE = (
  Platform.OS === 'web'
    ? (process.env.EXPO_BASE_URL ?? '')
    : (process.env.EXPO_PUBLIC_STATIC_URL ?? 'https://mutaaf.github.io/18-0')
).replace(/\/+$/, '');

interface StatLineState {
  /** Cards whose published line differs from this build's. Empty when current. */
  overrides: ReadonlyMap<string, readonly StatLine[]>;
  /** The revision those overrides came from, for the operator console. */
  revision: string | null;
  checked: boolean;
}

const useStatLineState = create<StatLineState>(() => ({
  overrides: new Map(),
  revision: null,
  checked: false,
}));

/**
 * A card's stat line, corrected if this build is behind.
 *
 * Subscribed, so the one render that happens when a table lands is the only
 * one. The bundle's own line is the fallback and the common answer.
 */
export function useCardStats(card: BootCard | undefined): readonly StatLine[] {
  // Accepts undefined so a screen that looks a card up by id can still call
  // this before it knows whether the lookup found one -- a hook cannot be
  // called after an early return.
  return useStatLineState((s) => (card ? (s.overrides.get(card.id) ?? card.stats) : EMPTY));
}

const EMPTY: readonly StatLine[] = [];

/** The same read, for anywhere that is not a component. */
export function cardStats(card: BootCard): readonly StatLine[] {
  return useStatLineState.getState().overrides.get(card.id) ?? card.stats;
}

/** What the operator console shows: whether this build is behind, and by what. */
export function useStatLineStatus(): {
  checked: boolean;
  revision: string | null;
  corrected: number;
  bundled: string;
} {
  const checked = useStatLineState((s) => s.checked);
  const revision = useStatLineState((s) => s.revision);
  const corrected = useStatLineState((s) => s.overrides.size);
  return { checked, revision, corrected, bundled: DATASET.statLinesRevision };
}

async function fetchJson(path: string, timeoutMs: number): Promise<unknown | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/${path}`, { signal: abort.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Offline, blocked, slow, or serving something that is not JSON. All of
    // them mean the same thing here: the bundle's own lines stand.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keep only the lines that actually differ from this build's.
 *
 * A stale build is usually stale about a handful of cards -- the running back
 * fix touched 1,233 of 4,872, the defence fix 59 -- and holding the other four
 * thousand would be four thousand redundant entries in memory and in the cache.
 * It also makes the count mean something: `corrected` is the number of cards
 * this device is showing differently from the bundle it shipped with, which is
 * exactly what somebody debugging wants to know.
 */
function divergent(parsed: ParsedStatLines): Map<string, readonly StatLine[]> {
  const out = new Map<string, readonly StatLine[]>();
  for (const [id, stats] of parsed.cards) {
    const mine = cardById(id)?.stats;
    if (!mine) continue;
    const same =
      mine.length === stats.length &&
      mine.every((s, i) => s.label === stats[i]!.label && s.value === stats[i]!.value);
    if (!same) out.set(id, stats);
  }
  return out;
}

function apply(parsed: ParsedStatLines): void {
  useStatLineState.setState({ overrides: divergent(parsed), revision: parsed.revision });
}

/**
 * Check once at boot. Never throws, never blocks, never retries.
 *
 * A retry would be a second chance to fix cosmetics on a device that has
 * already decided it has no network, which is not worth a wake-up.
 */
export async function startStatLines(): Promise<void> {
  const knows = (id: string) => cardById(id) !== undefined;

  // The cache first, so a cold start on a plane still shows yesterday's
  // corrections. Dropped when the bundle has caught up to it -- an app update
  // makes the cached table redundant rather than authoritative.
  const cached = await readCache();
  if (cached && cached.revision !== DATASET.statLinesRevision) apply(cached);

  const manifest = parseManifest(await fetchJson('stat-lines-manifest.json', 4000));
  if (!manifest) {
    useStatLineState.setState({ checked: true });
    return;
  }

  if (manifest.revision === DATASET.statLinesRevision) {
    // This build is current. Anything cached is from an older revision and has
    // just been superseded by the app itself.
    useStatLineState.setState({ overrides: new Map(), revision: null, checked: true });
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    return;
  }
  if (cached?.revision === manifest.revision) {
    useStatLineState.setState({ checked: true });
    return; // already applied above
  }

  const parsed = parseStatLines(await fetchJson('stat-lines.json', 15_000), knows);
  if (parsed) {
    apply(parsed);
    // The diff, not the table: it is what was applied, and it is what the next
    // cold start needs.
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        revision: parsed.revision,
        cards: Object.fromEntries(
          [...useStatLineState.getState().overrides].map(([id, stats]) => [
            id,
            stats.map((s) => [s.label, s.value]),
          ]),
        ),
      }),
    ).catch(() => undefined);
  }
  useStatLineState.setState({ checked: true });
}

async function readCache(): Promise<ParsedStatLines | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // Validated on the way out as strictly as on the way in: a cache is a file
    // on a device, and it outlives the build that wrote it.
    return parseStatLines(JSON.parse(raw), (id) => cardById(id) !== undefined);
  } catch {
    return null;
  }
}
