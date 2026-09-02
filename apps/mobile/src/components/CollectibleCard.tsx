import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { displayName, era as eraDef, franchise, type BootCard } from '@18-0/data';
import { color, elevate, font, positionColor, radius, space, tabular, tracking } from '@/theme';
import { useCardTilt } from './useCardTilt';

/**
 * The card as an object, rather than a heading with facts under it.
 *
 * The detail screen opened with a position chip, a name and a rating in a
 * column, which is a spec sheet. This game is about collecting seasons, so the
 * thing you tapped should look like something you collected: the franchise's
 * own colours, a foil sheen, and a face that moves when you touch it.
 *
 * The tilt is a real perspective transform driven by a pan gesture, so the
 * sheen slides across as the card turns. It is small on purpose -- eight
 * degrees, not thirty -- because the point is that the surface has depth, not
 * that it is a toy.
 */
export function CollectibleCard({
  card,
  blind,
}: {
  card: BootCard;
  /** Player IQ: no rating on the face, same as everywhere else. */
  blind: boolean;
}) {
  const team = franchise(card.franchiseId);
  const accent = positionColor[card.position];
  const teamColor = team.color || color.navy;
  const teamColor2 = team.color2 || teamColor;

  const { panHandlers, transform, sheenShift } = useCardTilt();

  return (
    <View style={styles.stage}>
      <Animated.View
        {...panHandlers}
        style={[
          styles.card,
          elevate(8),
          {
            borderColor: `${teamColor}88`,
            transform,
          },
        ]}
        accessible
        accessibilityLabel={`${displayName(card)}. ${card.position}. ${card.year} ${team.name}.${
          blind ? '' : ` Rating ${card.rating.toFixed(1)}.`
        }`}
      >
        {/* The franchise's colours across the face. */}
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
          <Defs>
            <LinearGradient id={`cc-${card.id}`} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={teamColor} stopOpacity="0.55" />
              <Stop offset="0.5" stopColor={teamColor2} stopOpacity="0.18" />
              <Stop offset="1" stopColor="#000000" stopOpacity="0.35" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#cc-${card.id})`} />
        </Svg>

        {/* Foil. A wide, soft band that slides with the tilt. */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { transform: [{ translateX: sheenShift }] }]}
        >
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id={`cc-foil-${card.id}`} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0.10" />
                <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0.16" />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#cc-foil-${card.id})`} />
          </Svg>
        </Animated.View>

        <View style={styles.face}>
          <View style={styles.top}>
            <View style={[styles.position, { borderColor: `${accent}80`, backgroundColor: `${accent}22` }]}>
              <Text style={[styles.positionText, { color: accent }]}>{card.position}</Text>
            </View>
            <Text style={styles.year}>{card.year}</Text>
          </View>

          <View style={styles.middle}>
            <Text style={styles.name} numberOfLines={2}>
              {displayName(card)}
            </Text>
            <Text style={styles.team}>
              {team.name} · {eraDef(card.era)?.name ?? card.era}
            </Text>
          </View>

          <View style={styles.bottom}>
            {blind ? (
              <Text style={styles.hidden}>RATING HIDDEN</Text>
            ) : (
              <View>
                <Text style={styles.ratingLabel}>18-0 rating</Text>
                <Text style={styles.rating}>{card.rating.toFixed(1)}</Text>
              </View>
            )}
            <View style={styles.chips}>
              {card.stats.slice(0, 2).map((stat) => (
                <View key={stat.label} style={styles.chip}>
                  <Text style={styles.chipValue}>{stat.value}</Text>
                  <Text style={styles.chipLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </Animated.View>

      <Text style={styles.hint}>
        {Platform.OS === 'web' ? 'Drag the card to turn it' : 'Touch and drag to turn the card'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', gap: space.sm },
  card: {
    // Dragging a card on the web selected its text instead of turning it.
    userSelect: 'none',
    width: '100%',
    maxWidth: 380,
    aspectRatio: 0.72,
    borderRadius: radius.xl,
    borderWidth: 1,
    backgroundColor: '#080B12',
    overflow: 'hidden',
  },
  face: { flex: 1, padding: space.lg, justifyContent: 'space-between' },

  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  position: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 3 },
  positionText: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide },
  year: { fontFamily: font.display, fontSize: 20, color: '#FFFFFFAA', ...tabular },

  middle: { gap: 2 },
  name: {
    fontFamily: font.displayBlack,
    fontSize: 38,
    lineHeight: 38,
    color: color.text,
    includeFontPadding: false,
  },
  team: { fontFamily: font.bodyRegular, fontSize: 13, color: '#FFFFFFB0' },

  bottom: { gap: space.sm },
  ratingLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: '#FFFFFF80',
  },
  rating: {
    fontFamily: font.display,
    fontSize: 52,
    lineHeight: 54,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  hidden: {
    fontFamily: font.label,
    fontSize: 13,
    letterSpacing: tracking.wider,
    color: '#FFFFFF66',
  },
  chips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: '#FFFFFF24',
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
  },
  chipValue: { fontFamily: font.display, fontSize: 15, color: color.text, ...tabular },
  chipLabel: {
    fontFamily: font.label,
    fontSize: 8,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: '#FFFFFF80',
  },

  hint: {
    fontFamily: font.bodyRegular,
    fontSize: 11,
    color: color.textFaint,
  },
});
