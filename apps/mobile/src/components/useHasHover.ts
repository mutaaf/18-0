import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Whether this device has a pointer that can hover.
 *
 * The dock magnifies under the cursor and names the tile it is over, and
 * neither of those events exists on a touch screen. A tablet would otherwise
 * get a row of unlabelled icons and no way to find out what they are without
 * tapping each one, so it gets standing labels instead.
 *
 * A native build is a touch device; an iPad with a trackpad attached will read
 * as touch here too, which costs it a hover effect it would otherwise have had
 * and costs it nothing else.
 */
export function useHasHover(): boolean {
  const [hover, setHover] = useState(Platform.OS === 'web');

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    setHover(query.matches);
    const onChange = (event: MediaQueryListEvent) => setHover(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return hover;
}
