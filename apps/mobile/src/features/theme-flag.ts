import { useEffect } from 'react';
import { useFlag } from '@/features/flags';
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
 */
export function useThemeFlagGuard(): void {
  const enabled = useFlag('theme_picker');
  const active = useThemeId();

  useEffect(() => {
    if (!enabled && active !== DEFAULT_THEME) setTheme(DEFAULT_THEME);
  }, [enabled, active]);
}
