import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { AccountPanel } from '@/components/AccountPanel';
import {
  fetchLeaderboard,
  identity,
  isBackendConfigured,
  type Identity,
} from '@/services/supabase';
import { color, font, space, tracking, useLayout } from '@/theme';

/**
 * Your account, on its own.
 *
 * It used to live at the bottom of the leaderboard, which put a sign-in form
 * and a delete link inside a screen about rankings and meant the only route to
 * either was scrolling past everybody else's scores.
 *
 * The board rank is still fetched here, because the manager card carries it and
 * a card that says nothing about where you stand is a worse card.
 */
export default function Account() {
  const layout = useLayout();
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

  return (
    <Screen maxWidth={layout.wide ? 760 : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Account</Text>
          <Text style={styles.subtitle}>
            {me?.named ? me.handle : 'Your name, your card, your seasons'}
          </Text>
        </View>
        <View style={styles.body}>
          <AccountPanel rank={rank} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 140 },
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
  body: { paddingHorizontal: space.lg },
});
