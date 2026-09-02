import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { radius, space, type PressState } from '@/theme';
import type { SocialProvider } from '@/services/auth';

/**
 * The sign-in buttons, drawn to each platform's own specification.
 *
 * These are not free-form. Apple's Human Interface Guidelines and Google's
 * branding guidelines both dictate the mark, the wording, the colours and the
 * minimum size, and App Review looks at the Apple one. A house-styled button
 * with the word "Apple" in it is a rejection waiting to happen, so the marks
 * are drawn properly and the two buttons deliberately do not match each other.
 *
 * Both sets of guidelines say to use the light treatment on a dark background,
 * which is why Apple's is white here rather than the more familiar black, and
 * why Google's uses its dark-theme palette (#131314 on #8E918F) rather than a
 * colour picked from this app.
 *
 * Logos are inline vectors rather than bundled images so they stay sharp at any
 * size and add nothing to the download.
 */
export function ProviderButton({
  provider,
  disabled,
  onPress,
}: {
  provider: SocialProvider;
  disabled?: boolean;
  onPress: () => void;
}) {
  const apple = provider === 'apple';
  const label = apple ? 'Sign in with Apple' : 'Sign in with Google';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ hovered, pressed }: PressState) => [
        styles.button,
        apple ? styles.apple : styles.google,
        hovered && { opacity: 0.92 },
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <View style={styles.mark}>{apple ? <AppleMark /> : <GoogleMark />}</View>
      <Text style={[styles.label, apple ? styles.appleLabel : styles.googleLabel]}>{label}</Text>
    </Pressable>
  );
}

/** Apple's mark, black for use on the white button. */
function AppleMark() {
  return (
    <Svg width={17} height={20} viewBox="0 0 24 24">
      <Path
        fill="#000000"
        d="M17.05 12.54c-.02-2.32 1.9-3.43 1.98-3.49-1.08-1.58-2.76-1.8-3.36-1.82-1.43-.15-2.79.84-3.52.84-.72 0-1.84-.82-3.03-.8-1.56.02-3 .91-3.8 2.3-1.62 2.81-.41 6.96 1.16 9.24.77 1.11 1.69 2.36 2.89 2.31 1.16-.05 1.6-.75 3-.75s1.79.75 3.02.72c1.25-.02 2.04-1.13 2.8-2.25.88-1.29 1.24-2.54 1.26-2.6-.03-.01-2.42-.93-2.44-3.7z"
      />
      <Path
        fill="#000000"
        d="M14.7 5.3c.64-.78 1.07-1.86.95-2.94-.92.04-2.03.61-2.69 1.38-.59.69-1.11 1.79-.97 2.85 1.03.08 2.07-.52 2.71-1.29z"
      />
    </Svg>
  );
}

/** Google's four-colour G. The mark is never recoloured to match a theme. */
function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    // Apple specifies a minimum height and a corner radius near this ratio;
    // 48 also clears the 44pt touch target both platforms ask for.
    height: 48,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
  },
  // "Use the white button on dark backgrounds." — Apple HIG.
  apple: { backgroundColor: '#FFFFFF' },
  // Google's dark-theme button: surface #131314, outline #8E918F.
  google: { backgroundColor: '#131314', borderWidth: 1, borderColor: '#8E918F' },

  mark: { alignItems: 'center', justifyContent: 'center' },
  label: {
    // The system face on purpose: both guidelines specify their own platform
    // font, and neither wants this rendered in a game's display type.
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  appleLabel: { color: '#000000' },
  googleLabel: { color: '#E3E3E3' },
});
