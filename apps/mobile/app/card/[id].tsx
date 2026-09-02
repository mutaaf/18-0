import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  cardById,
  componentBreakdown,
  displayName,
  eraLabel,
  franchise,
  unavailableComponents,
} from '@18-0/data';
import { Screen } from '@/components/Screen';
import { useGameStore } from '@/state/game';
import { CollectibleCard } from '@/components/CollectibleCard';
import { DECORATIVE, color, font, positionColor, radius, space, tabular, tracking } from '@/theme';

/**
 * Player detail (PRFAQ §22.3). Shows enough to trust the number — component
 * scores, which metric produced each, and how far above the league that
 * season was — without being required to play.
 */
export default function CardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const card = id ? cardById(decodeURIComponent(id)) : undefined;
  // Player IQ hides the numbers everywhere, including here — otherwise the
  // detail screen is just a way around the mode.
  const blind = useGameStore((s) => s.mode === 'player_iq' && s.status !== 'complete');

  if (!card) {
    return (
      <Screen>
        <View style={styles.missing}>
          <Text style={styles.missingText}>That card isn't in the dataset.</Text>
        </View>
      </Screen>
    );
  }

  const team = franchise(card.franchiseId);
  const components = componentBreakdown(card);
  const missing = unavailableComponents(card);
  const accent = positionColor[card.position];

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        {/* A bare router.back() strands anyone who arrived without history --
            a shared link, a reload on the web, or a deep link into a card --
            because there is nothing to go back to and the tap does nothing.
            Falling through to the game is always somewhere. */}
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/play'))}
          hitSlop={20}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.closeHit}
        >
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* The card as an object first. The numbers that explain it follow. */}
        <CollectibleCard card={card} blind={blind} />

        <View style={styles.hero}>
          <Text style={styles.meta}>
            {card.year} {team.name} · {eraLabel(card.era)} · {card.games} games
          </Text>
          {blind ? (
            <Text style={styles.blindNote}>
              Ratings are hidden in Player IQ mode. They arrive with your result.
            </Text>
          ) : null}
        </View>

        {blind ? null : (
        <View style={styles.statStrip}>
          {card.stats.slice(0, 4).map((stat) => (
            <View key={stat.label} style={styles.statCell}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
        )}

        {blind ? null : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Component scores</Text>
          <Text style={styles.sectionNote}>
            Each component is measured against every other {card.position} in {card.year} — not
            against history. That is what makes eras comparable.
          </Text>
          {components.map((component) => (
            <View key={component.key} style={styles.component}>
              <View style={styles.componentTop}>
                <Text style={styles.componentLabel} numberOfLines={1}>
                  {component.label}
                </Text>
                <Text style={styles.componentScore}>{component.score.toFixed(1)}</Text>
              </View>
              <View
            style={styles.track}
            {...DECORATIVE}
          >
                <View
                  style={[
                    styles.trackFill,
                    { width: `${Math.max(0, Math.min(100, component.score))}%`, backgroundColor: accent },
                  ]}
                />
              </View>
              <Text style={styles.componentMeta}>
                {Math.round(component.weight * 100)}% of rating
                {component.z !== null ? ` · ${component.z >= 0 ? '+' : ''}${component.z.toFixed(2)} SD vs league` : ' · league percentile'}
              </Text>
            </View>
          ))}
        </View>
        )}

        {!blind && missing.length > 0 ? (
          <View style={styles.missingData}>
            <Text style={styles.missingDataTitle}>Not measurable for this season</Text>
            <Text style={styles.missingDataCopy}>
              {missing.join(', ')}. These carry no score — their weight was redistributed across
              the components that do have data, never counted as zero.
            </Text>
          </View>
        ) : null}

        {card.archetypes.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Style</Text>
            <View style={styles.archetypes}>
              {card.archetypes.map((archetype) => (
                <View key={archetype} style={styles.archetype}>
                  <Text style={styles.archetypeText}>{archetype.replace(/_/g, ' ')}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.sectionNote}>
              Style affects chemistry only, and chemistry never moves a rating by more than a point.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'flex-end', paddingHorizontal: space.lg, paddingTop: space.sm },
  closeHit: { padding: space.sm, marginRight: -space.sm },
  close: {
    fontFamily: font.body,
    fontSize: 18,
    color: color.textDim,
    minWidth: 44,
    minHeight: 44,
    lineHeight: 44,
    textAlign: 'center',
  },
  scroll: { paddingHorizontal: space.lg, paddingBottom: 40, gap: space.xl },
  hero: { gap: 4 },
  positionTag: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  positionText: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide },
  name: {
    fontFamily: font.displayBlack,
    fontSize: 36,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
    marginTop: 4,
  },
  meta: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  ratingCaption: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, flex: 1 },
  blindNote: {
    fontFamily: font.bodyRegular,
    fontSize: 12,
    color: color.textFaint,
    marginTop: space.md,
    lineHeight: 17,
  },
  statStrip: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: space.md, backgroundColor: '#FFFFFF04' },
  statValue: { fontFamily: font.display, fontSize: 19, color: color.text, includeFontPadding: false, ...tabular },
  statLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: color.textFaint,
  },
  section: { gap: space.sm },
  sectionTitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  sectionNote: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint, lineHeight: 17 },
  component: { gap: 3, marginTop: space.sm },
  componentTop: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  componentLabel: { fontFamily: font.body, fontSize: 13, color: color.text, flex: 1 },
  componentScore: { fontFamily: font.heading, fontSize: 14, color: color.textDim, ...tabular },
  track: { height: 3, borderRadius: 2, backgroundColor: '#FFFFFF0D', overflow: 'hidden' },
  trackFill: { height: 3, borderRadius: 2, opacity: 0.8 },
  componentMeta: { fontFamily: font.bodyRegular, fontSize: 10, color: color.textFaint },
  missingData: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space.lg,
    gap: 4,
    backgroundColor: '#FFFFFF04',
  },
  missingDataTitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: color.textDim,
    textTransform: 'uppercase',
  },
  missingDataCopy: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint, lineHeight: 17 },
  archetypes: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  archetype: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  archetypeText: {
    fontFamily: font.body,
    fontSize: 11,
    color: color.textDim,
    textTransform: 'capitalize',
  },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  missingText: { fontFamily: font.body, fontSize: 14, color: color.textDim },
});
