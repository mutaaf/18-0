import { Platform } from 'react-native';

/**
 * Hide a decorative subtree from assistive technology.
 *
 * `accessibilityElementsHidden` is iOS-only and `importantForAccessibility` is
 * Android-only; spreading both onto every platform meant react-native-web
 * forwarded them to the DOM as unknown attributes, and every decorative element
 * in the app logged a React error on the web build. Each platform gets the prop
 * it actually understands, and the web gets `aria-hidden`, which is the thing
 * the other two were standing in for all along.
 */
export const DECORATIVE = Platform.select({
  ios: { accessibilityElementsHidden: true },
  android: { importantForAccessibility: 'no-hide-descendants' as const },
  default: { 'aria-hidden': true },
}) as Record<string, unknown>;
