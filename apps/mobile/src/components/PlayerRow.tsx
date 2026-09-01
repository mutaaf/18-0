import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DatasetCard } from '@18-0/data';
import { color, font, positionColor, radius, space, tracking, type PressState } from '@/theme';
import { RatingBadge } from './RatingBadge';

/**
 * One eligible card. Shows enough to choose — name, season, rating and a few
 * headline numbers — without turning the primary flow into a spreadsheet
 * (PRFAQ §45).
 */
export function PlayerRow({
  card,
  name,
  selected,
  disabled,
  onPress,
  onDetails,
}: {
  card: DatasetCard;
  name: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  onDetails: () => void;
}) {
  const accent = positionColor[card.position];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${name}. ${card.position}. ${card.year}. Rating ${card.rating.toFixed(1)}.${
        disabled ? ' Already on your roster.' : ''
      }`}
      onPress={disabled ? undefined : onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.row,
        hovered && !disabled && { backgroundColor: '#FFFFFF0A', borderColor: `${accent}59` },
        selected && { borderColor: accent, backgroundColor: '#FFFFFF0A' },
        disabled && styles.disabled,
        pressed && !disabled && { backgroundColor: '#FFFFFF14' },
      ]}
    >
      <View style={[styles.position, { borderColor: `${accent}66`, backgroundColor: `${accent}1A` }]}>
        <Text style={[styles.positionText, { color: accent }]}>{card.position}</Text>
      </View>

      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.stats}>
          <Text style={styles.year}>{card.year}</Text>
          {card.stats.slice(0, 3).map((stat) => (
            <Text key={stat.label} style={styles.stat}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}> {stat.label}</Text>
            </Text>
          ))}
        </View>
      </View>

      <Pressable
        onPress={onDetails}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Details for ${name}`}
        style={styles.info}
      >
        <Text style={styles.infoGlyph}>i</Text>
      </Pressable>

      <RatingBadge rating={card.rating} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 9,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#FFFFFF05',
  },
  disabled: { opacity: 0.32 },
  position: {
    width: 38,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  positionText: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide },
  main: { flex: 1, minWidth: 0 },
  name: { fontFamily: font.heading, fontSize: 16, color: color.text, includeFontPadding: false },
  stats: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 1 },
  year: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  stat: { fontSize: 11 },
  statValue: { fontFamily: font.bodyBold, color: color.textDim },
  statLabel: { fontFamily: font.bodyRegular, color: color.textFaint, fontSize: 10 },
  info: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoGlyph: { fontFamily: font.bodyBold, fontSize: 11, color: color.textFaint, includeFontPadding: false },
});
