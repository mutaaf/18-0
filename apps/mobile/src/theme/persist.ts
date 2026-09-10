import AsyncStorage from '@react-native-async-storage/async-storage';
import { isThemeId, THEMES, type ThemeId } from './palettes';
import { activeThemeId, onThemeChanged, setTheme } from './runtime';

/**
 * Remembering the choice, and telling the page about it.
 *
 * Split from `runtime.ts` so that module can stay free of storage and of React
 * Native -- see the note on `onThemeChanged`. Everything here has a side effect
 * on the world outside React, and none of it is on the path of a render.
 */

const STORAGE_KEY = '18-0:theme';

/**
 * Restores the saved theme at boot, and starts saving every change after it.
 *
 * Nothing waits for this. The app renders in the shipped palette and repaints
 * when it lands, which on a warm start is a frame or two. A theme is not worth
 * holding a splash screen for, and a player who never changed it sees no
 * repaint at all.
 */
export async function startTheme(): Promise<void> {
  // Registered before the read, so a change made while storage is still
  // answering is not the one that gets lost.
  onThemeChanged((id) => {
    void AsyncStorage.setItem(STORAGE_KEY, id).catch(() => undefined);
    paintDocument(id);
  });

  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (isThemeId(saved)) setTheme(saved);
  } catch {
    // No storage is the same as no preference.
  }

  // Runs whether or not anything was restored: on a first visit the document
  // still has to be told what the default is.
  paintDocument(activeThemeId());
}

/**
 * The page behind the app.
 *
 * Web only, by feature detection rather than by `Platform`. The browser paints
 * the document before React mounts and keeps showing it through overscroll at
 * the edges, so without this a navy app bounces against a black gutter -- and
 * the address bar on mobile Safari stays the wrong colour the whole time.
 */
function paintDocument(id: ThemeId): void {
  if (typeof document === 'undefined') return;
  const ground = THEMES[id].color.void;
  document.documentElement.style.backgroundColor = ground;
  document.body.style.backgroundColor = ground;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ground);
}
