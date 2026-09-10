import { useSyncExternalStore } from 'react';
import {
  DEFAULT_THEME,
  THEMES,
  isThemeId,
  type Palette,
  type Shape,
  type Theme,
  type ThemeId,
} from './palettes';

/**
 * Swapping the whole visual identity at runtime, without a provider and
 * without rewriting forty stylesheets.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A CONTEXT
 * ---------------------------------------------------------------------------
 *
 * The obvious shape is `<ThemeProvider>` and `useTheme()`, and it fails here
 * for a specific reason: every one of the forty component files ends in
 *
 *     const styles = StyleSheet.create({ root: { backgroundColor: color.void } })
 *
 * at *module scope*, which runs once when the module is first imported and
 * copies the string out of the palette. A context cannot reach that. Making it
 * reach that means converting all forty to `const styles = useStyles()` and
 * touching every component body in the app -- a very large diff through
 * working, shipped code, to add a feature nobody has evaluated yet.
 *
 * The observation that avoids it: *every other* colour read in this codebase
 * already happens during render. `fill={color.silver}` inside JSX, `borderColor:
 * tint ?? color.line` in a style array -- those are evaluated on every render
 * and are already live. Module-scope `StyleSheet.create` is the only thing that
 * freezes. There are exactly forty of them and they are structurally identical,
 * so the fix is one wrapper each and no change inside any component:
 *
 *     const styles = themed(() => StyleSheet.create({ ... }))
 *
 * `themed` returns a proxy that resolves to the *current* theme's sheet on
 * every property access. `styles.root` inside render therefore returns the
 * right object after a switch, and the sheet for each theme is built once and
 * cached. The cost is a proxy trap per style lookup, which is nothing next to
 * the render it is part of.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PALETTE IS MUTATED IN PLACE
 * ---------------------------------------------------------------------------
 *
 * `color` and `radius` are exported objects that other modules captured a
 * reference to at import time. Reassigning the export would leave every one of
 * those references pointing at the old palette, so the objects' *contents* are
 * replaced instead and the identity is stable forever. This is the one place in
 * the codebase that mutates a module-level object, and it is why `color` is
 * typed as `Palette` rather than declared `as const`: it genuinely is not.
 */

let active: ThemeId = DEFAULT_THEME;

/** Bumped on every switch. Style caches key off it; hooks re-render on it. */
let epoch = 0;

const listeners = new Set<() => void>();

/**
 * The live palette. Same object forever, different contents per theme.
 *
 * Read it during render and you get the current theme. Read it at module scope
 * and you get whatever was active when that module was first imported, which is
 * the trap `themed()` exists to close.
 */
export const color: Palette = { ...THEMES[DEFAULT_THEME].color };

/** The live shape scale. Same contract as `color`. */
export const radius: Shape = { ...THEMES[DEFAULT_THEME].radius };

export function activeTheme(): Theme {
  return THEMES[active];
}

export function activeThemeId(): ThemeId {
  return active;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Re-renders the calling component when the theme changes.
 *
 * Only needed by components wrapped in `memo`, which by design do not re-render
 * when a parent does. Everything else is reached by the root re-render. Calling
 * it anyway is harmless.
 */
export function useThemeId(): ThemeId {
  return useSyncExternalStore(subscribe, () => active, () => active);
}

/** For a picker that needs the name and the note, not just the id. */
export function useTheme(): Theme {
  return THEMES[useThemeId()];
}

/**
 * A stylesheet that follows the theme.
 *
 * Wraps a factory rather than taking the sheet directly, because the factory
 * has to run *after* the palette has been swapped -- and once per theme, not
 * once per render.
 */
export function themed<T extends object>(factory: () => T): T {
  const cache = new Map<ThemeId, T>();

  const sheet = (): T => {
    const existing = cache.get(active);
    if (existing) return existing;
    const built = factory();
    cache.set(active, built);
    return built;
  };

  // The target is a plain object rather than the built sheet: building it here
  // would run the factory at module scope, which is the freeze this avoids.
  return new Proxy({} as T, {
    get: (_target, key) => sheet()[key as keyof T],
    has: (_target, key) => key in (sheet() as object),
    ownKeys: () => Reflect.ownKeys(sheet() as object),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Object.getOwnPropertyDescriptor(sheet() as object, key);
      // A proxy may only report a non-configurable property if the target has
      // one, and the target is empty. Without this the spread and enumeration
      // that React Native's style flattening does would throw.
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

/**
 * Anything that should happen *outside* React when the theme changes: saving
 * the choice, repainting the document. Registered by `persist.ts` at boot.
 *
 * It is a hook rather than a direct call so this module can stay free of React
 * Native and of storage, which is what lets `theme.test.ts` -- running in a
 * node environment where `react-native` will not import -- exercise the switch
 * for real instead of mocking it.
 */
type Effect = (id: ThemeId) => void;
const effects = new Set<Effect>();

export function onThemeChanged(effect: Effect): () => void {
  effects.add(effect);
  return () => effects.delete(effect);
}

/**
 * Switches the theme for the whole app.
 *
 * The palette is replaced before listeners fire, so any sheet rebuilt during
 * the resulting render already sees the new colours.
 */
export function setTheme(id: ThemeId): void {
  if (!isThemeId(id) || id === active) return;
  active = id;
  epoch += 1;
  Object.assign(color, THEMES[id].color);
  Object.assign(radius, THEMES[id].radius);
  for (const listener of listeners) listener();
  for (const effect of effects) effect(id);
}

/** Test seam: resets to the shipped default between cases. */
export function __resetTheme(): void {
  active = DEFAULT_THEME;
  epoch += 1;
  Object.assign(color, THEMES[DEFAULT_THEME].color);
  Object.assign(radius, THEMES[DEFAULT_THEME].radius);
  for (const listener of listeners) listener();
}
