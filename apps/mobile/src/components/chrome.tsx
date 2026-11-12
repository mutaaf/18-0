import { createContext, useContext } from 'react';

/**
 * How much of a tab screen the navigation floats over, on each edge.
 *
 * The tab layout used to pad the scene itself -- `paddingBottom` under the
 * floating dock, `paddingRight` beside the rail on a wide window. The scene is
 * outside the screen's backdrop, so that padding drew bare `void`: a dead band
 * under every wide screen that the glass dock sat on, and a dead strip beside
 * the rail. The screen applies it instead, inside its own backdrop, so the
 * stadium runs under the navigation and only the content stops short.
 */
export interface Chrome {
  readonly bottom: number;
  readonly right: number;
}

export const NO_CHROME: Chrome = { bottom: 0, right: 0 };

const ChromeContext = createContext<Chrome>(NO_CHROME);

export const ChromeProvider = ChromeContext.Provider;

/** Zero outside the tabs: a screen with no navigation over it reserves nothing. */
export function useChrome(): Chrome {
  return useContext(ChromeContext);
}
