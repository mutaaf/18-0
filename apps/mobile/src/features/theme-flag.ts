import { useEffect } from 'react';
import { useFlag, useFlagStatus } from '@/features/flags';
import { DEFAULT_THEME, setTheme, useThemeId } from '@/theme';

/**
 * Ties the theme runtime to the flag that governs it.
 *
 * Lives at the root rather than inside `ThemePicker`, and the difference
 * matters: a kill switch that only runs where the control is drawn reaches
 * somebody exactly when they go looking for the control. Turning `theme_picker`
 * off would have left every player who had chosen Turf still in it -- on the
 * home screen, mid-game, everywhere except the one screen that could put them
 * back -- until they happened to open Account.
 *
 * Here it runs on the first render after the flags resolve, wherever they are.
 *
 * The other direction is deliberately not symmetrical: turning the flag *on*
 * restores nobody to Turf. A saved preference is restored by `startTheme`, and
 * a player whose theme was reset while the flag was down chose Broadcast the
 * moment they were put there. Re-theming somebody's app without them asking is
 * the thing this is trying to avoid, not a feature.
 *
 * **It waits for `ready`, and that is the whole correctness of it.** An
 * unresolved flag reads as its fallback, and this one's fallback is off -- so
 * without the wait, every cold start ran the guard against a flag that had not
 * answered yet and threw the player back to Broadcast a moment after
 * `startTheme` restored them, permanently, because the reset persists. It
 * presented as "the simulator will not stay on Turf" and it was this. `ready`
 * turns true when the fetch settles *or fails*, so a device that is offline
 * forever still ends up enforcing the fallback -- just not before it has been
 * asked.
 */
export function useThemeFlagGuard(): void {
  const { ready } = useFlagStatus();
  const enabled = useFlag('theme_picker');
  const active = useThemeId();

  useEffect(() => {
    if (!ready) return;
    if (!enabled && active !== DEFAULT_THEME) setTheme(DEFAULT_THEME);
  }, [ready, enabled, active]);
}
