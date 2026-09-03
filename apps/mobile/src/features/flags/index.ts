import { useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { fetchRemoteFlags, setFlagProperties } from '@/features/analytics';
import { track } from '@/features/telemetry';
import {
  FLAGS,
  FLAG_LIST,
  isValidValue,
  resolveAll,
  resolveFlag,
  type FlagDefinition,
  type FlagKey,
  type FlagValue,
  type Resolved,
} from './registry';

export * from './registry';

/**
 * The flag runtime.
 *
 * Four properties, in the order they mattered while writing it.
 *
 * **Offline is the normal case.** 18-0 plays with no account and no
 * connection, so a flag has to be answerable before any network call and
 * without one ever succeeding. Reads are synchronous against memory that was
 * populated from the registry's own fallbacks at import time; the remote
 * answer, if it arrives, replaces them.
 *
 * **One evaluation per launch.** Flags are fetched once at startup and then
 * held. Not for the round trip -- it is one small POST -- but because an
 * experiment whose variant can change under a player mid-session measures
 * nothing, and a marquee that rewords itself while somebody is reading it is a
 * bug however correct the flag was.
 *
 * **The last answer survives a cold start.** The payload is cached, so a phone
 * opened on a train behaves like the phone that was online yesterday rather
 * than snapping back to the shipped defaults. Cached values are used
 * regardless of age: a week-old flag is a far better guess than pretending the
 * experiment was never running.
 *
 * **Reading a flag is an event.** PostHog computes an experiment from
 * `$feature_flag_called`, so a variant that is resolved but never reported is
 * a variant with no denominator. Exposure fires on first read of each key,
 * once per session, and every subsequent event carries `$feature/<key>` so any
 * funnel in the product can be broken down by variant without new
 * instrumentation.
 */

const REMOTE_KEY = '18-0:flags:remote';
const OVERRIDE_KEY = '18-0:flags:overrides';

interface FlagState {
  /** What PostHog last said. Null until a fetch or a cache read succeeds. */
  remote: Record<string, unknown> | null;
  /** Device-local decisions from the operator console. */
  overrides: Record<string, unknown>;
  /** True once startFlags() has finished, however it finished. */
  ready: boolean;
  /** Where the current values came from, for the console. */
  fetchedAt: number | null;
  cached: boolean;
}

const useFlagState = create<FlagState>(() => ({
  remote: null,
  overrides: {},
  ready: false,
  fetchedAt: null,
  cached: false,
}));

/** Keys whose exposure has already been reported this session. */
const exposed = new Set<string>();

const definitionFor = (key: FlagKey): FlagDefinition => FLAGS[key];

/**
 * Read a flag.
 *
 * Synchronous by design: a component deciding what to render cannot await, and
 * a flag that resolves a frame late is a flag that makes the screen flicker.
 * Before startup finishes this returns the registry's fallback, which is the
 * shipping behaviour, so an early read is correct rather than merely safe.
 */
export function flag<K extends FlagKey>(key: K): FlagValue<K> {
  const { remote, overrides } = useFlagState.getState();
  const definition = definitionFor(key);
  const { value } = resolveFlag(definition, remote, overrides);
  reportExposure(definition, value);
  return value as FlagValue<K>;
}

/** The same read, plus where the answer came from. For the console. */
export function flagDetail<K extends FlagKey>(key: K): Resolved<K> {
  const { remote, overrides } = useFlagState.getState();
  const definition = definitionFor(key);
  const { value, source } = resolveFlag(definition, remote, overrides);
  return { key, value: value as FlagValue<K>, source };
}

/**
 * A flag, as a hook.
 *
 * Subscribed, so the one render that happens when the remote answer lands is
 * the only one: components do not poll, and nothing re-reads on every frame.
 */
export function useFlag<K extends FlagKey>(key: K): FlagValue<K> {
  const value = useFlagState((s) => {
    const { value: resolved } = resolveFlag(definitionFor(key), s.remote, s.overrides);
    return resolved;
  });
  reportExposure(definitionFor(key), value);
  return value as FlagValue<K>;
}

/**
 * Everything, resolved. The console's list.
 *
 * Subscribed to the two raw slices and derived in a `useMemo`, rather than
 * resolved inside the selector -- a selector that builds an array returns a new
 * reference every time it runs, zustand compares with `Object.is`, and the
 * store therefore looks changed on every render. That is an infinite render
 * loop, and it is what the first version of this did: the operator console
 * opened straight onto "Maximum update depth exceeded".
 *
 * `remote` and `overrides` are only ever replaced wholesale, so their
 * identities are stable and this recomputes exactly when something moved.
 */
export function useAllFlags(): Resolved[] {
  const remote = useFlagState((s) => s.remote);
  const overrides = useFlagState((s) => s.overrides);
  return useMemo(() => resolveAll(remote, overrides), [remote, overrides]);
}

/**
 * How the current values were arrived at. Three primitive subscriptions for
 * the same reason as above: nothing here may allocate.
 */
export function useFlagStatus(): { ready: boolean; fetchedAt: number | null; cached: boolean } {
  const ready = useFlagState((s) => s.ready);
  const fetchedAt = useFlagState((s) => s.fetchedAt);
  const cached = useFlagState((s) => s.cached);
  return { ready, fetchedAt, cached };
}

/**
 * Tell the analytics service which variant this player is in.
 *
 * Attached to every event by `analytics.ts`, which is what makes an existing
 * funnel -- spins, picks, completions -- breakable down by variant without
 * anybody instrumenting anything twice.
 *
 * Only flags that are actually doing something are reported: a flag sitting on
 * its fallback is the product, not a treatment, and shipping it as a property
 * on every event would suggest an experiment where there is none.
 */
export function activeFlagProperties(): Record<string, string | number | boolean> {
  const { remote, overrides } = useFlagState.getState();
  const properties: Record<string, string | number | boolean> = {};
  for (const resolved of resolveAll(remote, overrides)) {
    if (resolved.source === 'fallback') continue;
    properties[`$feature/${resolved.key}`] = resolved.value as string | boolean;
  }
  return properties;
}

/**
 * The exposure event PostHog's experiment analysis counts.
 *
 * Once per key per session. Firing it on every read would multiply the
 * denominator by however often a component happens to re-render, which is not
 * a number anybody should be dividing by.
 */
function reportExposure(definition: FlagDefinition, value: boolean | string): void {
  if (exposed.has(definition.key)) return;
  exposed.add(definition.key);
  track('$feature_flag_called', {
    $feature_flag: definition.key,
    $feature_flag_response: typeof value === 'boolean' ? String(value) : value,
  });
}

/**
 * Start the runtime: cache first, then the network.
 *
 * Never rejects and never blocks anything. The worst outcome is that every
 * flag stays on its fallback, which is the behaviour the app was built and
 * tested with.
 */
export async function startFlags(): Promise<void> {
  // Registered first: an event captured while the fetch is still in the air
  // should still say which variant produced it.
  setFlagProperties(activeFlagProperties);

  const stored = await readJson(REMOTE_KEY);
  const overrides = (await readJson(OVERRIDE_KEY)) ?? {};
  useFlagState.setState({
    remote: stored ? sanitise(stored) : null,
    overrides: sanitise(overrides),
    cached: stored !== null,
  });

  const fresh = await fetchRemoteFlags().catch(() => null);
  if (fresh) {
    const clean = sanitise(fresh);
    useFlagState.setState({ remote: clean, fetchedAt: Date.now(), cached: false });
    await AsyncStorage.setItem(REMOTE_KEY, JSON.stringify(clean)).catch(() => undefined);
  }
  useFlagState.setState({ ready: true });
}

/**
 * Keep only keys this build knows about, holding values this build allows.
 *
 * A payload arrives from a web form and outlives the app that reads it: keys
 * for flags already deleted, variants renamed since release, a toggle somebody
 * set to a string. Filtering on the way in means the rest of the runtime never
 * has to be defensive, and a stale cache can never resurrect a flag the code
 * no longer has.
 */
function sanitise(payload: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const definition of FLAG_LIST) {
    const value = payload[definition.key];
    if (value !== undefined && isValidValue(definition, value)) clean[definition.key] = value;
  }
  return clean;
}

async function readJson(key: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Force a value on this device.
 *
 * For QA and for support: "I cannot reproduce the variant you are describing"
 * is otherwise unanswerable when assignment is server-side and sticky.
 * Persisted, because a device-local override that vanished on reload would be
 * useless for exactly the multi-launch bug it exists to chase -- and the
 * console shows every overridden flag with a way to clear it, so it cannot
 * quietly become this device's permanent configuration.
 *
 * It cannot reach a rating: no flag can. See the invariant in `registry.ts`.
 */
export async function setOverride(key: FlagKey, value: boolean | string | null): Promise<void> {
  const next = { ...useFlagState.getState().overrides };
  if (value === null) delete next[key];
  else if (isValidValue(definitionFor(key), value)) next[key] = value;
  else return;
  useFlagState.setState({ overrides: next });
  await AsyncStorage.setItem(OVERRIDE_KEY, JSON.stringify(next)).catch(() => undefined);
}

export async function clearOverrides(): Promise<void> {
  useFlagState.setState({ overrides: {} });
  await AsyncStorage.removeItem(OVERRIDE_KEY).catch(() => undefined);
}

/** Which flags this device is forcing, for the badge on the console. */
export function overriddenKeys(): string[] {
  return Object.keys(useFlagState.getState().overrides);
}
