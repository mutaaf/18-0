import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { DockSpacer } from '@/components/chrome';
import { Screen } from '@/components/Screen';
import { SpreadLayout } from '@/components/SpreadLayout';
import { useSpread } from '@/features/fold';
import { AccountPanel } from '@/components/AccountPanel';
import { CareerPanel } from '@/components/CareerPanel';
import { LevelPanel } from '@/components/LevelPanel';
import { PreferencesPanel } from '@/components/PreferencesPanel';
import { RhythmPanel } from '@/components/RhythmPanel';
import { TVSettings } from '@/features/tv/TVSettings';
import { isTV } from '@/features/tv/platform';
import {
  fetchLeaderboard,
  identity,
  isBackendConfigured,
  type Identity,
} from '@/services/supabase';
import { color, font, space, themed, tracking, useLayout, useThemeId } from '@/theme';

/**
 * Your account, on its own.
 *
 * It used to live at the bottom of the leaderboard, which put a sign-in form
 * and a delete link inside a screen about rankings and meant the only route to
 * either was scrolling past everybody else's scores.
 *
 * The board rank is still fetched here, because the manager card carries it and
 * a card that says nothing about where you stand is a worse card.
 *
 * Everything below the manager card comes off one walk of the local history --
 * `careerReport`, memoised on the store's array, so the three panels that read
 * it share a single build. Nothing here fetches: the analysis is about seasons
 * this device already has, and it is the same on a plane.
 */
export default function Account() {
  // Subscribes this screen to the palette. React Navigation memoizes the
  // element it was handed, so a theme change reaches the component that
  // *creates* this screen's children or it reaches nothing -- which showed up
  // as a repainted picker sitting inside a screen still wearing the old
  // colours. `theme.test.ts` asserts every route does this.
  useThemeId();
  const layout = useLayout();
  const { spread, ref: spreadRef, onLayout: onSpreadLayout } = useSpread();
  const [me, setMe] = useState<Identity | null>(null);
  const [rank, setRank] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!isBackendConfigured) return;
    const who = await identity().catch(() => null);
    setMe(who);
    if (!who) return setRank(null);
    const rows = await fetchLeaderboard('all_time').catch(() => []);
    const at = rows.findIndex((r) => r.userId === who.userId);
    setRank(at < 0 ? null : at + 1);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>Account</Text>
      <Text style={styles.subtitle}>
        {me?.named ? me.handle : 'Your name, your card, your seasons'}
      </Text>
    </View>
  );

  // Two pages: who you are on the leading one, what you have done on the
  // trailing one. As one centred column the manager card, the name field and
  // the sign-in buttons all ran across an iPhone Duo's fold.
  if (spread.kind !== 'single') {
    return (
      <Screen bleed>
        <View ref={spreadRef} onLayout={onSpreadLayout} style={styles.fill}>
          <SpreadLayout
            spread={spread}
            first={
              <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                {header}
                <View style={styles.body}>
                  {/* Apple TV: sound and broadcast mode, first, because on a
                      TV they are what this page is visited for. */}
                  {isTV ? <TVSettings /> : null}
                  <LevelPanel />
                  <AccountPanel rank={rank} />
                </View>
                <DockSpacer />
              </ScrollView>
            }
            second={
              <ScrollView contentContainerStyle={[styles.scroll, styles.second]} showsVerticalScrollIndicator={false}>
                <View style={styles.body}>
                  <CareerPanel />
                  <RhythmPanel />
                  <PreferencesPanel />
                </View>
                <DockSpacer />
              </ScrollView>
            }
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={layout.wide ? 760 : undefined}>
      <View ref={spreadRef} onLayout={onSpreadLayout} style={styles.fill}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {header}
          <View style={styles.body}>
            {isTV ? <TVSettings /> : null}
            <LevelPanel />
            <AccountPanel rank={rank} />
            <CareerPanel />
            <RhythmPanel />
            <PreferencesPanel />
          </View>
          <DockSpacer />
        </ScrollView>
      </View>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingBottom: 140 },
  // Level with the first panel on the leading page, below its title.
  second: { paddingTop: space.lg + 52 },
  header: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
  title: {
    fontFamily: font.displayBlack,
    fontSize: 34,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  subtitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  body: { paddingHorizontal: space.lg, gap: space.md },
}));
