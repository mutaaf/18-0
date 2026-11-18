import { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/Pressable';
import { Reveal } from './Reveal';
import { isTV } from '@/features/tv/platform';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { franchise, type BootCard } from '@17-0/data';
import { useCardStats } from '@/features/stat-lines';
import { showsRating, showsStats, type GameMode } from '@/state/game';
import { color, font, positionColor, radius, space, tabular, teamInk, teamWash, themed, tracking, type PressState, useThemeId } from '@/theme';

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
  preferFocus = false,
}: {
  card: BootCard;
  name: string;
  index: number;
  selected: boolean;
  disabled: boolean;
  /** Player IQ: no rating, no stats, and no detail screen to peek at. */
  /** Decides whether this row shows a rating, a stat line, or neither. */
  mode: GameMode;
  /**
   * Handed the card rather than closed over it, so one stable handler serves
   * every row and the memo above actually holds when the list re-renders.
   */
  onPress: (card: BootCard) => void;
  onDetails: (card: BootCard) => void;
  /** Apple TV: where the remote goes when a spin lands. */
  preferFocus?: boolean;
}) {
  // Memoized, and a theme change moves none of these props. Without the
  // subscription the roster keeps the old palette until something else forces
  // a re-render. See `StadiumBackdrop` for the same note.
  useThemeId();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stats = useCardStats(card);
  const team = franchise(card.franchiseId);
  const accent = positionColor[card.position];
  const teamColor = team.color || color.lineBright;
  const teamColor2 = team.color2 || teamColor;

  const label = `${name}. ${card.position}. ${card.year} ${team.name}.${
    showsRating(mode) ? ` Rating ${card.rating.toFixed(1)}.` : ''
  }${disabled ? ' Already on your roster.' : ''}`;

  /**
   * On a TV the whole row is the one focus target. Two siblings side by side
   * -- the card and a 22-point "i" -- made the remote stop twice per player
   * and put the details behind the smallest target on the screen. The
   * details are a long press of Select instead (said in the list's heading),
   * the same idiom the TV app uses for "more about this".
   */
  if (isTV) {
    return (
      <Reveal delay={Math.min(index, 12) * 24} distance={10} duration={260}>
        <Pressable
          hasTVPreferredFocus={preferFocus}
          accessibilityRole="button"
          accessibilityState={{ selected, disabled }}
          accessibilityLabel={`${label} Hold Select for details.`}
          accessibilityHint="Hold Select for details"
          onPress={disabled ? undefined : () => onPress(card)}
          onLongPress={() => onDetails(card)}
          delayLongPress={450}
          style={[styles.card, styles.tvCard, selected && { borderColor: accent }, disabled && styles.disabled]}
        >
          {/* In a wrapper the size of the card: an Svg sized "100%" inside a
              padded box takes the padding off its width and stops short. */}
          <View style={styles.wash} pointerEvents="none">
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id={`tc-${card.id}`} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={teamColor} stopOpacity="0.42" />
                  <Stop offset="0.42" stopColor={teamColor2} stopOpacity="0.10" />
                  <Stop offset="1" stopColor={teamColor} stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill={`url(#tc-${card.id})`} />
            </Svg>
          </View>
          <View style={[styles.rail, { backgroundColor: teamColor }]} pointerEvents="none" />
          <View style={styles.main}>
            <View style={[styles.position, { borderColor: `${accent}80`, backgroundColor: `${accent}1F` }]}>
              <Text style={[styles.positionText, { color: accent }]}>{card.position}</Text>
            </View>
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                {name}
              </Text>
              <View style={styles.metaRow}>
                <View style={[styles.season, { backgroundColor: teamWash(teamColor) }]}>
                  <Text style={[styles.team, { color: teamInk(teamColor) }]}>{team.abbr}</Text>
                  <Text style={[styles.year, { color: teamInk(teamColor) }]}>{card.year}</Text>
                </View>
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
              <View style={styles.tvHidden}>
                <Text style={styles.hiddenGlyph}>?</Text>
              </View>
            )}
          </View>
        </Pressable>
      </Reveal>
    );
  }

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
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={`tc-${card.id}`} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={teamColor} stopOpacity="0.42" />
                <Stop offset="0.42" stopColor={teamColor2} stopOpacity="0.10" />
                <Stop offset="1" stopColor={teamColor} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#tc-${card.id})`} />
          </Svg>
        </View>

        <View style={[styles.rail, { backgroundColor: teamColor }]} pointerEvents="none" />

        <Pressable
          hasTVPreferredFocus={preferFocus}
          accessibilityRole="button"
          accessibilityState={{ selected, disabled }}
          accessibilityLabel={`${name}. ${card.position}. ${card.year} ${team.name}.${
            showsRating(mode) ? ` Rating ${card.rating.toFixed(1)}.` : ''
          }${disabled ? ' Already on your roster.' : ''}`}
          onPress={disabled ? undefined : () => onPress(card)}
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
            {/* Shrinks a little before it cuts: a unit name ("1980 Buffalo Defense") on one page of a Duo lost its last word. */}
            <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
              {name}
            </Text>
            <View style={styles.metaRow}>
              {/* Team and year are what the player is choosing between, so they
                  carry the franchise's colour and the year is set large. */}
              <View style={[styles.season, { backgroundColor: teamWash(teamColor) }]}>
                <Text style={[styles.team, { color: teamInk(teamColor) }]}>{team.abbr}</Text>
                <Text style={[styles.year, { color: teamInk(teamColor) }]}>{card.year}</Text>
              </View>
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
            onPress={() => onDetails(card)}
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

const styles = themed(() => StyleSheet.create({
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
    backgroundColor: color.ink,
    overflow: 'hidden',
  },
  hovered: { borderColor: color.gold, transform: [{ translateY: -1 }] },
  pressed: { opacity: 0.9, transform: [{ scale: 0.995 }] },
  disabled: { opacity: 0.3 },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  /** TV: the row is the button, so it gets the room the "i" used to take. */
  tvCard: { paddingRight: space.lg, minHeight: 72 },
  tvHidden: {
    minWidth: 44,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },

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
  season: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  team: { fontFamily: font.label, fontSize: 12, color: color.silver, letterSpacing: tracking.wide },
  year: { fontFamily: font.display, fontSize: 15, color: color.text, ...tabular, includeFontPadding: false },
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
}));
