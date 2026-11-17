import { useEffect } from 'react';
import { BackHandler, TVEventControl } from 'react-native';
import { router, usePathname } from 'expo-router';
import { isTV } from './platform';

/** The tabs a TV's Menu button returns to Play from. Play itself is `/`. */
const TAB_PATHS = new Set(['/games', '/leaderboard', '/challenges', '/stats', '/account']);

/**
 * The remote's Menu (Back) button: back inside the app, home at its root.
 *
 * tvOS hands Menu to the app only while the app asks for it; otherwise the
 * button leaves for the home screen. React Native turns a captured press into
 * `hardwareBackPress`. So the job is to capture it exactly while there is
 * somewhere to go: Apple's tvOS review guidelines are specific that Menu at an
 * app's root must go home, and capturing it always would trap the player.
 *
 * Where it goes:
 *  - a pushed screen (play, a card, a challenge): back, by the navigator;
 *  - any tab but Play: to Play. The tab navigator's own idea of back is the
 *    first tab declared, Games, which is nowhere a player came from -- and
 *    changing its back behaviour moved the tab the app opens on;
 *  - Play: not captured, so tvOS takes the player home.
 *
 * The listener is re-added on every route change. BackHandler asks the newest
 * listener first, and the navigation container adds its own when it mounts --
 * after this one did -- so re-adding is what lets this answer before it.
 */
export function useTVMenuKey(): void {
  const pathname = usePathname();
  useEffect(() => {
    if (!isTV) return;
    const onTab = TAB_PATHS.has(pathname);
    // Not `canGoBack()` at Play: the tab navigator answers yes there too,
    // meaning "back to Games".
    if (pathname !== '/' && (onTab || router.canGoBack())) TVEventControl.enableTVMenuKey();
    else TVEventControl.disableTVMenuKey();
    if (!onTab) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      router.navigate('/');
      return true;
    });
    return () => subscription.remove();
  }, [pathname]);
}
