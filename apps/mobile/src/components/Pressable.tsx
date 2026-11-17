import { forwardRef, type ElementRef } from 'react';
import {
  Pressable as NativePressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { isTV } from '@/features/tv/platform';
import { color } from '@/theme';

/**
 * React Native's Pressable, with a focus ring on a television.
 *
 * On a phone and on the web this *is* React Native's Pressable -- the same
 * component object, not a wrapper -- so nothing there changes.
 *
 * On an Apple TV every Pressable is already a stop for the focus engine; what
 * it lacks is any sign of being the one the remote is on. The screens style
 * `pressed` and, on the web, `hovered`, and a TV has neither until the click.
 * So here every Pressable gets the tvOS idiom: lifted a little and ringed in
 * `focusRing`, drawn as an outline so it never moves its neighbours. A screen
 * that wants a different focus look can still read `focused` from the style
 * callback itself (`PressState`).
 *
 * `native-imports.test.ts` keeps this the only place that imports React
 * Native's.
 */
type Ref = ElementRef<typeof NativePressable>;

const focusRing = (): ViewStyle => ({
  outlineColor: color.focusRing,
  outlineStyle: 'solid',
  outlineWidth: 3,
  outlineOffset: 3,
  transform: [{ scale: 1.05 }],
  zIndex: 1,
});

const TVPressable = forwardRef<Ref, PressableProps>(function TVPressable({ style, ...props }, ref) {
  const styled = (state: PressableStateCallbackType): StyleProp<ViewStyle> => {
    const own = typeof style === 'function' ? style(state) : style;
    return (state as { focused?: boolean }).focused ? [own, focusRing()] : own;
  };
  return <NativePressable ref={ref} style={styled} {...props} />;
});

export const Pressable: typeof NativePressable = isTV ? (TVPressable as typeof NativePressable) : NativePressable;
export type { PressableProps };
