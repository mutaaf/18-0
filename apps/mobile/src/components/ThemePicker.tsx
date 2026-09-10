import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Line, Pattern, Rect, Stop } from 'react-native-svg';
import { Panel } from './Panel';
import { useFlag } from '@/features/flags';
import { track } from '@/features/telemetry';
import {
  DECORATIVE,
  THEME_LIST,
  color,
  font,
  radius,
  setTheme,
  space,
  themed,
  tracking,
  useThemeId,
  type PressState,
  type Theme,
} from '@/theme';

/**
 * Choosing the app's identity.
 *
 * Each option paints itself in its *own* palette rather than the active one,
 * which is the entire job of this control: a picker whose options are all the
 * same colour asks somebody to choose between two words. The swatch is a
 * miniature of the real thing -- ground, panel, a filled primary and an outline
 * secondary at that theme's own corner radius -- so the choice is made by
 * looking rather than by reading.
 *
 * The colours here are read from `THEME_LIST` at render, never from `color`,
 * for the same reason.
 */
export function ThemePicker() {
  const enabled = useFlag('theme_picker');
  const active = useThemeId();

  // Putting somebody back when the flag drops is `useThemeFlagGuard`, at the
  // root. It cannot live here: this component is only mounted on one screen.
  if (!enabled) return null;

  return (
    <Panel contentStyle={styles.body}>
      <Text style={styles.eyebrow}>Appearance</Text>
      <Text style={styles.title}>Pick a look</Text>
      <Text style={styles.copy}>
        Changes the whole app immediately. Nothing about how a season is scored moves.
      </Text>

      <View style={styles.options}>
        {THEME_LIST.map((theme) => (
          <Option
            key={theme.id}
            theme={theme}
            active={theme.id === active}
            onPress={() => {
              setTheme(theme.id);
              track('theme_changed', { theme: theme.id });
            }}
          />
        ))}
      </View>
    </Panel>
  );
}

function Option({
  theme,
  active,
  onPress,
}: {
  theme: Theme;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={active ? undefined : onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${theme.name}. ${theme.note}`}
      style={({ hovered, pressed }: PressState) => [
        styles.option,
        // The rim takes the option's own accent, so the selected state is the
        // theme announcing itself rather than a generic tick.
        active && { borderColor: theme.color.action },
        hovered && !active && styles.optionHover,
        pressed && styles.optionPressed,
      ]}
    >
      <Swatch theme={theme} />
      <View style={styles.optionText}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{theme.name}</Text>
          {active ? (
            <Text style={[styles.badge, { color: theme.color.action }]}>ON</Text>
          ) : null}
        </View>
        <Text style={styles.note}>{theme.note}</Text>
      </View>
    </Pressable>
  );
}

/**
 * The theme, at 92 by 62.
 *
 * Small enough to sit in a row and complete enough to be honest: the ground it
 * will actually paint, a panel on top of it, the primary control filled in the
 * action colour with a label in `onAction`, and one outline secondary. Turf's
 * weave is drawn too, because at this size the pinstripe is a surprising amount
 * of what makes the two grounds look different.
 */
function Swatch({ theme }: { theme: Theme }) {
  const c = theme.color;
  const r = theme.radius;
  const id = `sw-${theme.id}`;

  return (
    <Svg width={92} height={62} viewBox="0 0 92 62" {...DECORATIVE}>
      <Defs>
        <LinearGradient id={`${id}-ground`} x1="0" y1="0" x2="0.4" y2="1">
          <Stop offset="0" stopColor={c.panelTop} stopOpacity="0.85" />
          <Stop offset="1" stopColor={c.void} stopOpacity="1" />
        </LinearGradient>
        <Pattern id={`${id}-weave`} width="7" height="7" patternUnits="userSpaceOnUse">
          <Line x1="0" y1="7" x2="7" y2="0" stroke="#FFFFFF" strokeOpacity="0.05" strokeWidth="2" />
        </Pattern>
      </Defs>

      <Rect x="0" y="0" width="92" height="62" rx={r.sm} fill={c.void} />
      <Rect x="0" y="0" width="92" height="62" rx={r.sm} fill={`url(#${id}-ground)`} />
      {theme.id === 'turf' ? (
        <Rect x="0" y="0" width="92" height="62" rx={r.sm} fill={`url(#${id}-weave)`} />
      ) : null}

      {/* Two lines of type. */}
      <Rect x="9" y="10" width="38" height="4" rx="2" fill={c.text} opacity="0.9" />
      <Rect x="9" y="18" width="22" height="3" rx="1.5" fill={c.textFaint} opacity="0.8" />

      {/* The primary, filled, with a label in whatever survives on it. */}
      <Rect
        x="9"
        y="28"
        width="74"
        height="12"
        rx={Math.min(r.md, 6)}
        fill={c.action}
      />
      <Rect x="34" y="32.5" width="24" height="3" rx="1.5" fill={c.onAction} opacity="0.85" />

      {/* One outline secondary, at the same corner. */}
      <Rect
        x="9"
        y="44"
        width="74"
        height="12"
        rx={Math.min(r.md, 6)}
        fill="none"
        stroke={c.lineBright}
        strokeWidth="1.5"
      />
      <Rect x="34" y="48.5" width="24" height="3" rx="1.5" fill={c.silver} opacity="0.7" />
    </Svg>
  );
}

const styles = themed(() => StyleSheet.create({
  body: { padding: space.lg, gap: space.xs },
  eyebrow: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  title: { fontFamily: font.heading, fontSize: 19, color: color.text },
  copy: {
    fontFamily: font.bodyRegular,
    fontSize: 11,
    lineHeight: 16,
    color: color.textFaint,
    marginBottom: space.xs,
  },

  options: { gap: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
    borderRadius: radius.md,
    // Two points in both states: a selected option that thickens its own rim
    // shifts every row below it by a pixel.
    borderWidth: 2,
    borderColor: color.line,
    backgroundColor: '#FFFFFF06',
  },
  optionHover: { borderColor: color.lineBright, backgroundColor: '#FFFFFF0D' },
  optionPressed: { opacity: 0.9 },

  optionText: { flex: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { fontFamily: font.bodyBold, fontSize: 15, color: color.text },
  badge: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
  },
  note: { fontFamily: font.bodyRegular, fontSize: 11, lineHeight: 15, color: color.textFaint },
}));
