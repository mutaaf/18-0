import { Platform } from 'react-native';

/**
 * True on Apple TV (and Android TV), false everywhere else -- the web included,
 * where react-native-web has no `isTV` at all.
 *
 * Read once at import: a device does not stop being a television. On tvOS
 * `Platform.OS` is still 'ios', so a check for 'ios' alone is a check that
 * also matches the TV; anything that only exists on a phone (haptics, the
 * share sheet, notifications, a browser to sign in through) asks this first.
 * See docs/apple-tv.md.
 */
export const isTV: boolean = Platform.isTV === true;

/**
 * The verb for "press this": "Tap" under a finger, "Select" on the remote.
 * Apple's TV copy never says tap -- there is nothing to tap.
 */
export const pressVerb: 'Tap' | 'Select' = isTV ? 'Select' : 'Tap';
