import { createContext, useContext } from 'react';
import { View } from 'react-native';

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
  /** The TV's tab bar, across the top (TVTabBar.tsx). */
  readonly top?: number;
}

export const NO_CHROME: Chrome = { bottom: 0, right: 0 };

const ChromeContext = createContext<Chrome>(NO_CHROME);

export const ChromeProvider = ChromeContext.Provider;

/** Zero outside the tabs: a screen with no navigation over it reserves nothing. */
export function useChrome(): Chrome {
  return useContext(ChromeContext);
}

/**
 * The floating dock's reserve, spent at the end of a scroll rather than
 * around it.
 *
 * `Screen` used to stop its content `chrome.bottom` short of the window, so on
 * a wide window every scroll ended in a hard horizontal cut a dock's height
 * above the bottom edge: cards sliced through the middle, beside a band of
 * bare stadium, under a dock drawn as glass precisely so that things pass
 * beneath it. The scroll now runs to the edge and ends with this, so the last
 * row can still be scrolled clear of the dock. It is the last child of every
 * tab screen's scroll (`chrome.test.ts`), and nothing on a phone, whose bar
 * does not float.
 */
export function DockSpacer() {
  const { bottom } = useChrome();
  return bottom > 0 ? <View style={{ height: bottom, pointerEvents: 'none' }} /> : null;
}
