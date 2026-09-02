import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { DATASET, franchise, type BootCard } from '@18-0/data';
import { POSITIONS } from '@18-0/domain';
import { DECORATIVE, color, font, positionColor, radius, space, tabular, tracking } from '@/theme';

/**
 * The model's own verdict on the best seasons in the data, scrolling past.
 *
 * This is the landing page's whole credibility argument, and it makes it
 * without a word of marketing: nobody chose these names, they came out of the
 * ratings. If the model were wrong, this strip is where it would be obvious to
 * anyone who watches football — which is exactly why it belongs on the first
 * screen rather than buried in a methodology note.
 */

const CARD_WIDTH = 176;
const GAP = 10;
const STRIDE = CARD_WIDTH + GAP;
/** Slow enough to read a name, fast enough to feel alive. */
const MS_PER_CARD = 2600;

/** Top few at every position, so it reads as a league and not a receiver corps. */
function marqueeCards(perPosition = 3): BootCard[] {
  const byPosition = POSITIONS.flatMap((position) =>
    DATASET.cards
      .filter((card) => card.position === position)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, perPosition),
  );
  return byPosition.sort((a, b) => b.rating - a.rating);
}

export function Hall() {
  const cards = useMemo(() => marqueeCards(), []);
  const [reduced, setReduced] = useState<boolean | null>(null);
  const offset = useRef(new Animated.Value(0)).current;
  const span = cards.length * STRIDE;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => !cancelled && setReduced(value))
      .catch(() => setReduced(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (reduced !== false || span === 0) return;
    const loop = Animated.loop(
      Animated.timing(offset, {
        toValue: -span,
        duration: cards.length * MS_PER_CARD,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, span]);

  const strip = cards.map((card, index) => <HallCard key={`${card.id}-${index}`} card={card} />);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>The best seasons in the data</Text>
        <Text style={styles.note}>Nobody picked these. They fell out of the model.</Text>
      </View>

      {/* Reduce Motion gets the same cards as a strip you scroll yourself — the
          content is the point, the movement is not. */}
      {reduced === true ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
          {strip}
        </ScrollView>
      ) : (
        <View style={styles.viewport} {...DECORATIVE}>
          <Animated.View style={[styles.rail, { transform: [{ translateX: offset }] }]}>
            {strip}
            {/* A second copy, so the wrap-around has no seam. */}
            {cards.map((card, index) => (
              <HallCard key={`${card.id}-loop-${index}`} card={card} />
            ))}
          </Animated.View>
        </View>
      )}
    </View>
  );
}

function HallCard({ card }: { card: BootCard }) {
  const team = franchise(card.franchiseId);
  const accent = positionColor[card.position];
  const teamColor = team.color || '#3A3F4B';
  const gradientId = `hall-${card.id}`;

  return (
    <View style={styles.card}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={teamColor} stopOpacity="0.5" />
            <Stop offset="1" stopColor={teamColor} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
      <View style={[styles.cardRail, { backgroundColor: teamColor }]} />

      <View style={styles.cardTop}>
        <Text style={[styles.cardPosition, { color: accent }]}>{card.position}</Text>
        <Text style={[styles.cardRating, { color: card.rating >= 99 ? color.goldBright : color.text }]}>
          {card.rating.toFixed(1)}
        </Text>
      </View>
      <Text style={styles.cardName} numberOfLines={1}>
        {card.name || `${card.year} Defense`}
      </Text>
      <Text style={styles.cardMeta} numberOfLines={1}>
        {team.abbr} · {card.year}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  head: { gap: 2 },
  label: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  note: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim },

  viewport: { overflow: 'hidden' },
  rail: { flexDirection: 'row', gap: GAP },

  card: {
    width: CARD_WIDTH,
    paddingVertical: space.sm,
    paddingLeft: space.md,
    paddingRight: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#0D1017',
    overflow: 'hidden',
    gap: 1,
  },
  cardRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  cardTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardPosition: { fontFamily: font.label, fontSize: 10, letterSpacing: tracking.wide },
  cardRating: { fontFamily: font.display, fontSize: 20, includeFontPadding: false, ...tabular },
  cardName: {
    fontFamily: font.heading,
    fontSize: 16,
    color: color.text,
    includeFontPadding: false,
    marginTop: 2,
  },
  cardMeta: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, ...tabular },
});
