import { useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Image } from 'expo-image';
import { displayName, era as eraDef, franchise, headshotUrl, type BootCard } from '@18-0/data';
import { color, elevate, font, positionColor, radius, space, tabular, tracking } from '@/theme';
import { useCardTilt } from './useCardTilt';
import { useCardStats } from '@/features/stat-lines';

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
  const stats = useCardStats(card);
  const team = franchise(card.franchiseId);
  const accent = positionColor[card.position];
  const teamColor = team.color || color.navy;
  const teamColor2 = team.color2 || teamColor;

  const { panHandlers, transform, sheenShift } = useCardTilt();
  const photo = headshotUrl(card.entityId);

  /**
   * Turning the card over.
   *
   * A separate rotation from the tilt, appended after it, so the two compose:
   * a half-turned card still leans towards the finger. backfaceVisibility is
   * what keeps the two faces from showing through one another.
   */
  const [facingBack, setFacingBack] = useState(false);
  const flip = useRef(new Animated.Value(0)).current;

  const turnOver = () => {
    const next = !facingBack;
    setFacingBack(next);
    Animated.spring(flip, {
      toValue: next ? 1 : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 55,
    }).start();
  };

  const flipRotation = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  /**
   * Which face is showing, swapped at the halfway point.
   *
   * backfaceVisibility alone is not enough: it needs the parent to preserve 3D,
   * which react-native-web flattens, so the card turned and showed its own
   * front mirrored. Switching opacity at the halfway point is exact on every
   * platform, and the swap happens edge-on where nothing is legible anyway.
   */
  const frontOpacity = flip.interpolate({
    inputRange: [0, 0.5, 0.5001, 1],
    outputRange: [1, 1, 0, 0],
  });
  const backOpacity = flip.interpolate({
    inputRange: [0, 0.4999, 0.5, 1],
    outputRange: [0, 0, 1, 1],
  });

  return (
    <View style={styles.stage}>
      <Animated.View
        {...panHandlers}
        style={[
          styles.card,
          elevate(8),
          {
            borderColor: `${teamColor}88`,
            transform: [...transform, { rotateY: flipRotation }],
          },
        ]}
        accessible
        accessibilityLabel={`${displayName(card)}. ${card.position}. ${card.year} ${team.name}.${
          blind ? '' : ` Rating ${card.rating.toFixed(1)}.`
        }`}
      >
        {/* Everything that belongs to the front: the wash, the photograph, the
            scrim and the foil. All of it fades out together as the card turns. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: frontOpacity }]}
          pointerEvents="none"
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

        {/* The photograph, behind the type and under the foil. A team defence
            has nobody to show, and a missing one simply leaves the wash. */}
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={styles.photo}
            contentFit="cover"
            transition={220}
            // The CDN copy is small already; caching it means a card opened
            // twice does not fetch twice.
            cachePolicy="memory-disk"
            accessibilityIgnoresInvertColors
          />
        ) : null}

        {/* A scrim under the type. Without it the name sits directly on the
            photograph and is unreadable against a light jersey. It fades from
            nothing at the top of the portrait to the card's own ground, so the
            picture is not cut off by a hard edge. */}
        {photo ? (
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
            <Defs>
              <LinearGradient id={`cc-scrim-${card.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#080B12" stopOpacity="0" />
                <Stop offset="0.34" stopColor="#080B12" stopOpacity="0.12" />
                <Stop offset="0.56" stopColor="#080B12" stopOpacity="0.78" />
                <Stop offset="0.72" stopColor="#080B12" stopOpacity="1" />
                <Stop offset="1" stopColor="#080B12" stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#cc-scrim-${card.id})`} />
          </Svg>
        ) : null}

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
        </Animated.View>

        <Animated.View style={[styles.face, styles.front, { opacity: frontOpacity }]}>
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
              {stats.slice(0, 2).map((stat) => (
                <View key={stat.label} style={styles.chip}>
                  <Text style={styles.chipValue}>{stat.value}</Text>
                  <Text style={styles.chipLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </Animated.View>
        {/* The back. Rotated a half turn so it faces out once the card has
            turned, and hidden until then. */}
        <Animated.View style={[styles.face, styles.back, { opacity: backOpacity }]}>
          <Text style={styles.backLabel}>{card.year} season</Text>
          <View style={styles.backStats}>
            {stats.map((stat) => (
              <View key={stat.label} style={styles.backRow}>
                <Text style={styles.backRowLabel}>{stat.label}</Text>
                <Text style={styles.backRowValue}>{stat.value}</Text>
              </View>
            ))}
            <View style={styles.backRow}>
              <Text style={styles.backRowLabel}>GAMES</Text>
              <Text style={styles.backRowValue}>{card.games}</Text>
            </View>
          </View>
          <View>
            {card.archetypes.length > 0 ? (
              <Text style={styles.backNote} numberOfLines={2}>
                {card.archetypes
                  .map((a) => a.replace(/_/g, ' '))
                  .join(' · ')}
              </Text>
            ) : null}
            <Text style={styles.backTeam} numberOfLines={1}>
              {team.name} · {eraDef(card.era)?.label ?? card.era}
            </Text>
          </View>
        </Animated.View>

        {/* The tap target sits above both faces. The pan responder only claims
            a clear drag, so a tap reaches this and a drag still tilts. */}
        <Pressable
          onPress={turnOver}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={facingBack ? 'Show the front of the card' : 'Turn the card over'}
        />
      </Animated.View>

      <Text style={styles.hint}>
        {facingBack
          ? 'Tap to turn it back'
          : Platform.OS === 'web'
            ? 'Tap to turn it over, drag to tilt'
            : 'Tap to turn it over, drag to tilt'}
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
    maxWidth: 253,
    aspectRatio: 0.72,
    borderRadius: radius.xl,
    borderWidth: 1,
    backgroundColor: '#080B12',
    overflow: 'hidden',
  },
  face: { flex: 1, padding: space.md, justifyContent: 'space-between' },
  front: {},
  back: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Turned a half turn of its own, so that once the card has rotated 180 the
    // back reads the right way round rather than mirrored. backfaceVisibility
    // is deliberately not set: with the parent flattened it would treat this
    // face as pointing away and hide it entirely. Opacity does the swap.
    transform: [{ rotateY: '180deg' }],
    backgroundColor: '#080B12EE',
  },
  backLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  backStats: { gap: 2 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#FFFFFF14',
    paddingVertical: 4,
  },
  backRowLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  backRowValue: { fontFamily: font.display, fontSize: 15, color: color.text, ...tabular },
  backNote: {
    fontFamily: font.bodyRegular,
    fontSize: 10,
    color: color.textDim,
    textTransform: 'capitalize',
    marginBottom: 2,
  },
  backTeam: { fontFamily: font.bodyRegular, fontSize: 10, color: color.textFaint },
  photo: {
    position: 'absolute',
    // Anchored to the top so the face is not cropped, and stopping short of
    // the bottom so the name and rating sit on the wash rather than on a chin.
    top: 0,
    left: 0,
    right: 0,
    height: '58%',
    opacity: 0.9,
  },

  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  position: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 3 },
  positionText: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide },
  year: { fontFamily: font.display, fontSize: 18, color: '#FFFFFFAA', ...tabular },

  middle: { gap: 2 },
  name: {
    fontFamily: font.displayBlack,
    fontSize: 27,
    lineHeight: 28,
    color: color.text,
    includeFontPadding: false,
  },
  team: { fontFamily: font.bodyRegular, fontSize: 12, color: '#FFFFFFB0' },

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
    fontSize: 39,
    lineHeight: 40,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  hidden: {
    fontFamily: font.label,
    fontSize: 10,
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
  chipValue: { fontFamily: font.display, fontSize: 14, color: color.text, ...tabular },
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
