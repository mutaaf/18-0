import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Reveal } from './Reveal';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { franchise, type BootCard } from '@18-0/data';
import { useCardStats } from '@/features/stat-lines';
import { showsRating, showsStats, type GameMode } from '@/state/game';
import { color, font, positionColor, radius, space, tabular, tracking, type PressState } from '@/theme';

/**
 * A player card, not a spreadsheet row.
 *
 * Each one carries its franchise's own colours so a spin looks like that team's
 * cards, and reads as something collectible — PRFAQ §2: "position cards should
 * feel collectible and high-value."
 *
 * The row is a container holding two *sibling* controls: the card itself and
 * the details button. They used to be nested, which react-native-web renders as
 * a `<button>` inside a `<button>` — invalid HTML, and a keyboard user could
 * never reach the inner one. Hover and press state, which the outer Pressable's
 * render prop used to supply, is tracked here instead.
 */
export const PlayerCard = memo(function PlayerCard({
  card,
  name,
  index,
  selected,
  disabled,
  mode,
  onPress,
  onDetails,
}: {
  card: BootCard;
  name: string;
  index: number;
  selected: boolean;
  disabled: boolean;
  /** Player IQ: no rating, no stats, and no detail screen to peek at. */
  /** Decides whether this row shows a rating, a stat line, or neither. */
  mode: GameMode;
  onPress: () => void;
  onDetails: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stats = useCardStats(card);
  const team = franchise(card.franchiseId);
  const accent = positionColor[card.position];
  const teamColor = team.color || '#3A3F4B';
  const teamColor2 = team.color2 || teamColor;

  return (
    <Reveal delay={Math.min(index, 12) * 24} distance={10} duration={260}>
      <View
        style={[
          styles.card,
          hovered && !disabled && styles.hovered,
          selected && { borderColor: accent },
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}
      >
        {/* The team's own colours, washed across the card. */}
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id={`tc-${card.id}`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={teamColor} stopOpacity="0.42" />
              <Stop offset="0.42" stopColor={teamColor2} stopOpacity="0.10" />
              <Stop offset="1" stopColor={teamColor} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#tc-${card.id})`} />
        </Svg>

        <View style={[styles.rail, { backgroundColor: teamColor }]} pointerEvents="none" />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected, disabled }}
          accessibilityLabel={`${name}. ${card.position}. ${card.year} ${team.name}.${
            showsRating(mode) ? ` Rating ${card.rating.toFixed(1)}.` : ''
          }${disabled ? ' Already on your roster.' : ''}`}
          onPress={disabled ? undefined : onPress}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={styles.main}
        >
          <View style={[styles.position, { borderColor: `${accent}80`, backgroundColor: `${accent}1F` }]}>
            <Text style={[styles.positionText, { color: accent }]}>{card.position}</Text>
          </View>

          <View style={styles.body}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.team}>{team.abbr}</Text>
              <Text style={styles.year}>{card.year}</Text>
              {showsStats(mode)
                ? stats.slice(0, 3).map((stat) => (
                    <Text key={stat.label} style={styles.stat}>
                      <Text style={styles.statValue}>{stat.value}</Text>
                      <Text style={styles.statLabel}> {stat.label}</Text>
                    </Text>
                  ))
                : null}
            </View>
          </View>

          {showsRating(mode) ? (
            <View style={styles.ratingSeat}>
              <Text style={[styles.rating, ratingTone(card.rating)]}>{card.rating.toFixed(1)}</Text>
            </View>
          ) : (
            <View style={styles.hidden}>
              <Text style={styles.hiddenGlyph}>?</Text>
            </View>
          )}
        </Pressable>

        {/* Available in every mode. The screen it opens withholds exactly what
            the mode withholds, so this is a way to see the card, not a way
            around the rules of the game you chose. */}
        <Pressable
            onPress={onDetails}
            accessibilityRole="button"
            accessibilityLabel={`Details for ${name}`}
            style={({ hovered: over, pressed: down }: PressState) => [
              styles.info,
              over && styles.infoActive,
              down && styles.infoActive,
            ]}
          >
            <View style={styles.infoRing}>
              <Text style={styles.infoGlyph}>i</Text>
            </View>
        </Pressable>
      </View>
    </Reveal>
  );
});

function ratingTone(rating: number) {
  if (rating >= 97) return { color: color.goldBright };
  if (rating >= 93) return { color: '#7FE3B0' };
  if (rating >= 88) return { color: '#8FC4FF' };
  if (rating >= 80) return { color: color.text };
  return { color: color.textDim };
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    paddingVertical: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#101218',
    overflow: 'hidden',
  },
  hovered: { borderColor: color.gold, transform: [{ translateY: -1 }] },
  pressed: { opacity: 0.9, transform: [{ scale: 0.995 }] },
  disabled: { opacity: 0.3 },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },

  /** The card's own tap target: everything except the details button. */
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },

  position: {
    minWidth: 46,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  positionText: { fontFamily: font.label, fontSize: 13, letterSpacing: tracking.wide },

  body: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: font.heading, fontSize: 19, color: color.text, includeFontPadding: false },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  team: { fontFamily: font.label, fontSize: 12, color: color.silver, letterSpacing: tracking.wide },
  year: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint, ...tabular },
  stat: { fontSize: 12 },
  statValue: { fontFamily: font.bodyBold, color: color.textDim, ...tabular },
  statLabel: { fontFamily: font.bodyRegular, color: color.textFaint, fontSize: 11 },

  info: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  infoActive: { opacity: 0.7 },
  infoRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoGlyph: { fontFamily: font.bodyBold, fontSize: 12, color: color.textFaint },

  ratingSeat: { minWidth: 52, alignItems: 'flex-end' },
  rating: { fontFamily: font.display, fontSize: 26, includeFontPadding: false, ...tabular },

  hidden: {
    minWidth: 52,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenGlyph: { fontFamily: font.display, fontSize: 22, color: color.textFaint },
});
