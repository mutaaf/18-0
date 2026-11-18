import { forwardRef, useState, type ElementRef } from 'react';
import { TextInput as NativeTextInput, type TextInputProps } from 'react-native';
import { isTV } from '@/features/tv/platform';
import { color } from '@/theme';

/**
 * React Native's TextInput, with a focus ring on a television.
 *
 * Phones and the web get React Native's own component object, untouched. On an
 * Apple TV a field is a stop for the focus engine like any button, and tvOS
 * draws nothing to say the remote is on it -- so its border lights and it
 * lifts, as a `Pressable` does. Selecting it opens the system's full-screen keyboard.
 */
type Ref = ElementRef<typeof NativeTextInput>;

const TVTextInput = forwardRef<Ref, TextInputProps>(function TVTextInput({ style, onFocus, onBlur, ...props }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <NativeTextInput
      ref={ref}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        style,
        // Not an outline: UIKit draws that as a square box whatever the
        // field's corners. The field's own border lights instead.
        focused && { borderColor: color.focusRing, transform: [{ scale: 1.03 }], zIndex: 10 },
      ]}
    />
  );
});

export const TextInput: typeof NativeTextInput = isTV ? (TVTextInput as unknown as typeof NativeTextInput) : NativeTextInput;
