import { useTVEventHandler, type HWEvent } from 'react-native';
import { isTV } from './platform';

/**
 * The Siri Remote's raw events, on a TV only.
 *
 * `useTVEventHandler` exists only in react-native-tvos; on the web the name
 * resolves to nothing at all. Chosen once, at import, so it is the same hook
 * on every render and the rules of hooks hold.
 */
export const useTVRemote: (handler: (event: HWEvent) => void) => void = isTV
  ? useTVEventHandler
  : () => {};

export type { HWEvent };
