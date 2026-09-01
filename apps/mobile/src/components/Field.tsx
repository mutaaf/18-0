import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, G, Line, LinearGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { ROSTER_SLOTS, SLOT_POSITION, type RosterSlot } from '@18-0/domain';
import type { BootCard } from '@18-0/data';
import { color, font, positionColor, radius, space, tabular, tracking, useLayout } from '@/theme';

const SLOT_LABEL: Record<RosterSlot, string> = {
  QB: 'Quarterback',
  RB1: 'Running Back',
  RB2: 'Running Back',
  WR1: 'Wide Receiver',
  WR2: 'Wide Receiver',
  TE1: 'Tight End',
  DEF: 'Defensive Unit',
};

/**
 * Screen-reader names. RB1 and RB2 render the same words on screen, which is
 * fine visually and useless to VoiceOver — two buttons with byte-identical
 * accessible names.
 */
const SLOT_SPOKEN: Record<RosterSlot, string> = {
  QB: 'Quarterback',
  RB1: 'Running Back 1',
  RB2: 'Running Back 2',
  WR1: 'Wide Receiver 1',
  WR2: 'Wide Receiver 2',
  TE1: 'Tight End',
  DEF: 'Defense',
};

/** Yard numerals as a broadcast draws them: 10 up to 50 and back down. */
const YARD_NUMERALS = [10, 20, 30, 40, 50, 40, 30, 20, 10];

/**
 * A top-down field: chalk, hashes, and the yard numerals a broadcast uses.
 * Memoized — it takes no props and was being reconciled on every keystroke in
 * the search box above it.
 */
const Turf = memo(function Turf() {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      viewBox="0 0 300 260"
      preserveAspectRatio="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <LinearGradient id="turf" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0D2016" />
          <Stop offset="0.45" stopColor="#0A1A12" />
          <Stop offset="1" stopColor="#07110C" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="300" height="260" fill="url(#turf)" rx="14" />
      {/* Mowing stripes */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Rect key={i} x={i * 50} y="0" width="25" height="260" fill="#FFFFFF" opacity="0.014" />
      ))}
      {/* Yard lines every 10, hash ticks between them */}
      {Array.from({ length: 11 }, (_, i) => i * 26).map((y, i) => (
        <G key={y}>
          <Line x1="14" y1={y} x2="286" y2={y} stroke="#FFFFFF" strokeWidth="0.7" opacity={i % 2 === 0 ? 0.14 : 0.07} />
          {i > 0 && i < 10 ? (
            <>
              <Line x1="112" y1={y - 13} x2="118" y2={y - 13} stroke="#FFFFFF" strokeWidth="0.6" opacity="0.09" />
              <Line x1="182" y1={y - 13} x2="188" y2={y - 13} stroke="#FFFFFF" strokeWidth="0.6" opacity="0.09" />
            </>
          ) : null}
          {i > 0 && i < 10 ? (
            <>
              <SvgText x="26" y={y - 4} fill="#FFFFFF" opacity="0.16" fontSize="11" fontWeight="700">
                {String(YARD_NUMERALS[i - 1])}
              </SvgText>
              <SvgText x="262" y={y - 4} fill="#FFFFFF" opacity="0.16" fontSize="11" fontWeight="700">
                {String(YARD_NUMERALS[i - 1])}
              </SvgText>
            </>
          ) : null}
        </G>
      ))}
      <Rect x="1" y="1" width="298" height="258" rx="14" fill="none" stroke="#FFFFFF" strokeWidth="1" opacity="0.10" />
    </Svg>
  );
});

interface SlotProps {
  slot: RosterSlot;
  card: BootCard | undefined;
  franchiseAbbr: string | undefined;
  highlighted: boolean;
  targeted: boolean;
  blind: boolean;
  scale: number;
  onPress?: (slot: RosterSlot) => void;
}

function Slot({ slot, card, franchiseAbbr, highlighted, targeted, blind, scale, onPress }: SlotProps) {
  const accent = positionColor[SLOT_POSITION[slot]];
  const filled = card !== undefined;

  const label = filled
    ? `${SLOT_SPOKEN[slot]} slot. ${card.name || `${card.year} defense`}. ${card.year} ${
        franchiseAbbr ?? ''
      }.${blind ? '' : ` Rating ${card.rating.toFixed(1)}.`} Selected.`
    : `${SLOT_SPOKEN[slot]} slot. Empty.${onPress ? ' Tap to fill this position.' : ''}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: targeted }}
      onPress={onPress ? () => onPress(slot) : undefined}
      style={({ pressed }) => [
        styles.slot,
        { width: 96 * scale, minHeight: 62 * scale },
        filled ? styles.slotFilled : styles.slotEmpty,
        highlighted && { borderColor: accent, shadowColor: accent, shadowOpacity: 0.55 },
        targeted && styles.slotTargeted,
        targeted && { borderColor: accent, shadowColor: accent, shadowOpacity: 0.7 },
        pressed && onPress ? { opacity: 0.75 } : null,
      ]}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        style={[styles.slotKey, { color: filled ? accent : color.textFaint, fontSize: 9 * scale }]}
      >
        {slot}
      </Text>
      {filled ? (
        <>
          <Text style={[styles.slotName, { fontSize: 15 * scale }]} numberOfLines={1}>
            {surname(card)}
          </Text>
          <View style={styles.slotMeta}>
            <Text style={[styles.slotYear, { fontSize: 10 * scale }]}>
              {franchiseAbbr ?? ''} '{String(card.year).slice(2)}
            </Text>
            <Text style={[styles.slotRating, { color: accent, fontSize: 14 * scale }]}>
              {blind ? '' : card.rating.toFixed(1)}
            </Text>
          </View>
        </>
      ) : (
        <Text style={[styles.slotEmptyLabel, { fontSize: 10 * scale, lineHeight: 13 * scale }]} numberOfLines={2}>
          {targeted ? 'Choose a player' : SLOT_LABEL[slot]}
        </Text>
      )}
      <View style={[styles.slotUnderline, { backgroundColor: filled ? accent : color.line }]} />
    </Pressable>
  );
}

function surname(card: BootCard): string {
  if (card.position === 'DEF') return `${card.year}`;
  const parts = card.name.trim().split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : card.name;
}

export function Field({
  cards,
  franchiseAbbrs,
  highlight,
  target,
  blind,
  onSlotPress,
}: {
  cards: Partial<Record<RosterSlot, BootCard>>;
  franchiseAbbrs: Partial<Record<RosterSlot, string>>;
  highlight?: readonly RosterSlot[];
  /** The slot the player is filling right now. */
  target?: RosterSlot | null;
  blind?: boolean;
  onSlotPress?: (slot: RosterSlot) => void;
}) {
  const layout = useLayout();
  // A desktop window has the room for a bigger lineup graphic; a phone does not.
  const scale = layout.roomy ? 1.35 : layout.wide ? 1.2 : 1;
  const highlighted = new Set(highlight ?? []);
  const slot = (key: RosterSlot) => (
    <Slot
      key={key}
      slot={key}
      card={cards[key]}
      franchiseAbbr={franchiseAbbrs[key]}
      highlighted={highlighted.has(key)}
      targeted={target === key}
      blind={blind === true}
      scale={scale}
      {...(onSlotPress ? { onPress: onSlotPress } : {})}
    />
  );

  return (
    <View style={[styles.field, { paddingVertical: space.md * scale }]}>
      <Turf />
      <View style={styles.formation}>
        <View style={styles.row}>{slot('QB')}</View>
        <View style={[styles.row, styles.rowSpread]}>
          {slot('RB1')}
          {slot('RB2')}
        </View>
        <View style={[styles.row, styles.rowWide]}>
          {slot('WR1')}
          {slot('TE1')}
          {slot('WR2')}
        </View>
        <View style={styles.row}>{slot('DEF')}</View>
      </View>
    </View>
  );
}

export const ALL_SLOTS = ROSTER_SLOTS;

const styles = StyleSheet.create({
  field: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
  },
  formation: { gap: space.sm },
  row: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  rowSpread: { paddingHorizontal: '18%', justifyContent: 'space-between' },
  rowWide: { justifyContent: 'space-between', paddingHorizontal: 2 },
  slot: {
    borderRadius: radius.md,
    flexShrink: 1,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingTop: 5,
    paddingBottom: 7,
    justifyContent: 'flex-start',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
  },
  slotEmpty: {
    borderStyle: 'dashed',
    borderColor: '#FFFFFF30',
    backgroundColor: '#00000059',
  },
  slotTargeted: { borderStyle: 'solid', backgroundColor: '#0A0F14F2' },
  slotFilled: {
    borderColor: '#FFFFFF26',
    backgroundColor: '#080C10E6',
  },
  slotKey: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
  },
  slotName: {
    fontFamily: font.heading,
    fontSize: 15,
    color: color.text,
    marginTop: 1,
    includeFontPadding: false,
  },
  slotMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 1 },
  slotYear: { fontFamily: font.bodyRegular, fontSize: 10, color: color.textFaint },
  slotRating: { fontFamily: font.display, fontSize: 14, includeFontPadding: false },
  slotEmptyLabel: {
    fontFamily: font.bodyRegular,
    fontSize: 10,
    color: color.textFaint,
    marginTop: 4,
    lineHeight: 13,
  },
  slotUnderline: {
    position: 'absolute',
    left: 7,
    right: 7,
    bottom: 3,
    height: 2,
    borderRadius: 1,
    opacity: 0.7,
  },
});
