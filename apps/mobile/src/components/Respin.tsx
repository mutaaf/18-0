import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useShallow } from 'zustand/react/shallow';
import { RESPINS_PER_SEASON, RESPIN_MARK, RESPIN_MARK_MEANING, oddsDisclosure } from '@17-0/respins/client';
import { franchise, era as eraDef } from '@17-0/data';
import { useFlag } from '@/features/flags';
import { openBuckets, useGameStore } from '@/state/game';
import { noteStoreUsed, purchases, refreshRespinBalance, spendRespin, useRespinBalance, type PackOffer } from '@/features/respins';
import { track } from '@/features/telemetry';
import { useFoldPage } from '@/features/fold';
import { color, elevate, font, radius, space, themed, tracking, type PressState } from '@/theme';

/**
 * The ↻ mark: a season that spent a respin, wherever a season is shown.
 *
 * Not behind the `respins` flag. A respun season is a fact the server
 * recorded, and a mark that vanished with a toggle would let one pass as
 * clean on a board -- the one thing the mark is for.
 */
export function RespinMark({ size = 13, label = false }: { size?: number; label?: boolean }) {
  return (
    <Text
      style={[styles.mark, { fontSize: size }]}
      accessibilityLabel="Used a respin"
      accessibilityHint={RESPIN_MARK_MEANING}
    >
      {RESPIN_MARK}
      {label ? ' Respin' : ''}
    </Text>
  );
}

/**
 * The quiet "↻ Respin" beside a landed spin, with the balance.
 *
 * Shown only while there is something to respin: a spin has landed, nothing
 * has been picked from it, and the season has a respin left. Tapping with no
 * balance opens the sheet; with no connection, says so -- the balance is the
 * server's, and an honest "needs a connection" beats a spinner (invariant 3).
 */
export function RespinControl({ onRespun }: { onRespun: (message: string) => void }) {
  const enabled = useFlag('respins');
  const game = useGameStore(
    useShallow((s) => ({
      status: s.status,
      spins: s.spins,
      respinsUsed: s.respinsUsed,
    })),
  );
  const balance = useRespinBalance((s) => s.balance);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (enabled) void refreshRespinBalance();
  }, [enabled]);

  const spin = game.spins[game.spins.length - 1];
  // A new spin clears the last one's complaint.
  useEffect(() => setProblem(null), [spin?.sequence]);

  if (!enabled || game.status !== 'spun' || !spin) return null;
  const spent = game.respinsUsed >= RESPINS_PER_SEASON;

  const press = async () => {
    if (busy || spent) return;
    if (balance === 0) {
      setSheet(true);
      return;
    }
    setBusy(true);
    setProblem(null);
    const before = { franchiseId: spin.franchiseId, era: spin.era };
    const outcome = await spendRespin();
    setBusy(false);
    if (outcome.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onRespun(
        `Respun: ${franchise(before.franchiseId).abbr} ${eraDef(before.era).label} is gone. ` +
          `${franchise(outcome.spin.franchiseId).name}, ${eraDef(outcome.spin.era).label}.`,
      );
      return;
    }
    if (outcome.kind === 'no_balance') {
      setSheet(true);
      return;
    }
    setProblem(outcome.kind === 'offline' ? 'Respins need a connection.' : outcome.message);
  };

  return (
    <View style={styles.controlRow}>
      <Pressable
        onPress={press}
        disabled={busy || spent}
        accessibilityRole="button"
        accessibilityLabel={
          spent
            ? 'Respin used this season'
            : `Respin this spin. ${balance === null ? '' : `${balance} respins left.`}`
        }
        accessibilityHint="Draws a new franchise-era for this turn. The season is marked with a respin."
        accessibilityState={{ disabled: busy || spent, busy }}
        style={({ pressed, hovered }: PressState) => [
          styles.control,
          hovered && !spent && styles.controlHover,
          pressed && !spent && { opacity: 0.8 },
          spent && styles.controlSpent,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={color.silver} />
        ) : (
          <Text style={styles.controlLabel}>
            {RESPIN_MARK} {spent ? 'Respin used' : 'Respin'}
          </Text>
        )}
        {!spent && balance !== null ? (
          <View style={styles.balance}>
            <Text style={styles.balanceText}>{balance}</Text>
          </View>
        ) : null}
      </Pressable>
      {problem ? (
        <Text style={styles.problem} accessibilityLiveRegion="polite">
          {problem}
        </Text>
      ) : null}
      {sheet ? <RespinSheet onClose={() => setSheet(false)} /> : null}
    </View>
  );
}

/**
 * The purchase sheet: two packs at StoreKit's price, the odds, what the mark
 * means, and the small print App Review asks for.
 *
 * The odds are counted from the season in front of the player when there is
 * one (`openBuckets` -- the same set the server draws from), so "1 in 230" is
 * this turn's number, not a figure from a slide.
 */
export function RespinSheet({ onClose }: { onClose: () => void }) {
  const page = useFoldPage();
  const balance = useRespinBalance((s) => s.balance);
  const open = useGameStore((s) => (s.status === 'spun' ? openBuckets(s).length : null));
  const [offers, setOffers] = useState<PackOffer[] | null | 'loading'>(purchases.canSell ? 'loading' : null);
  const [buying, setBuying] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    track('respin_sheet_opened', { platform: Platform.OS, balance: balance ?? -1 });
    if (!purchases.canSell) return;
    let live = true;
    void purchases.offers().then((found) => {
      if (live) setOffers(found);
    });
    return () => {
      live = false;
    };
    // Once per sheet: the balance it opened with is the number worth knowing.
  }, []);

  const buy = async (offer: PackOffer) => {
    if (buying) return;
    setBuying(offer.productId);
    noteStoreUsed();
    setMessage(null);
    const outcome = await purchases.buy(offer.productId);
    setBuying(null);
    switch (outcome.kind) {
      case 'granted':
        track('respin_purchased', { respins: outcome.respins });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setMessage(`${outcome.respins} respins added. You have ${outcome.balance}.`);
        break;
      case 'cancelled':
        break;
      default:
        setMessage(outcome.message);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingLeft: space.lg + page.left, paddingRight: space.lg + page.right },
          ]}
        >
          <View style={styles.sheet} accessibilityViewIsModal aria-modal role="dialog" aria-label="Respins">
            <Text style={styles.kicker}>{RESPIN_MARK} RESPINS</Text>
            <Text style={styles.headline} accessibilityRole="header">
              Not this one.
            </Text>
            <Text style={styles.body}>
              A respin sends the spin that just landed back and draws a new franchise-era for the same turn, before
              you pick. One per season.
              {balance !== null ? ` You have ${balance}.` : ''}
            </Text>

            {purchases.canSell ? (
              offers === 'loading' ? (
                <ActivityIndicator color={color.silver} style={styles.loading} />
              ) : offers === null ? (
                <Text style={styles.note}>The App Store is not answering right now. Try again in a moment.</Text>
              ) : (
                <View style={styles.packs}>
                  {offers.map((offer) => (
                    <Pressable
                      key={offer.productId}
                      onPress={() => buy(offer)}
                      disabled={buying !== null}
                      accessibilityRole="button"
                      accessibilityLabel={`${offer.respins} respins for ${offer.price}`}
                      style={({ pressed, hovered }: PressState) => [
                        styles.pack,
                        hovered && styles.controlHover,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={styles.packCount}>{offer.respins}</Text>
                      <Text style={styles.packLabel}>respins</Text>
                      {buying === offer.productId ? (
                        <ActivityIndicator color={color.onAction} style={styles.packPrice} />
                      ) : (
                        <Text style={styles.packPrice}>{offer.price}</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              )
            ) : (
              <Text style={styles.soldElsewhere}>Respins are sold in the iOS app.</Text>
            )}

            {message ? (
              <Text style={styles.message} accessibilityLiveRegion="polite">
                {message}
              </Text>
            ) : null}

            <View style={styles.rules}>
              <Text style={styles.ruleTitle}>The odds</Text>
              <Text style={styles.rule}>{oddsDisclosure(open)}</Text>
              <Text style={styles.ruleTitle}>{RESPIN_MARK} on the boards</Text>
              <Text style={styles.rule}>
                A season that used a respin still counts in ranked play and carries {RESPIN_MARK} beside it on every
                board and roster. Every board has a Clean only view, and the perfect-season board counts clean seasons
                alone.
              </Text>
              <Text style={styles.rule}>
                Respins are consumable and don&apos;t transfer between Apple IDs. They belong to your 17-0 account, so
                signing in keeps them.
              </Text>
            </View>

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={({ pressed }: PressState) => [styles.close, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.closeLabel}>Done</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    mark: { fontFamily: font.bodyBold, color: color.ice },

    controlRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
    control: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      minHeight: 44,
      paddingHorizontal: space.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: color.lineBright,
      backgroundColor: color.surfaceRaised,
    },
    controlHover: { transform: [{ translateY: -1 }] },
    controlSpent: { opacity: 0.55 },
    controlLabel: { fontFamily: font.label, fontSize: 15, letterSpacing: tracking.normal, color: color.text },
    balance: {
      minWidth: 22,
      paddingHorizontal: 6,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.ice,
    },
    balanceText: { fontFamily: font.bodyBold, fontSize: 12, color: color.inkDeep },
    problem: { fontFamily: font.body, fontSize: 12, color: color.silver, flexShrink: 1 },

    backdrop: { flex: 1, backgroundColor: color.scrim },
    scroll: { flex: 1 },
    scrollContent: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: space.lg,
      paddingVertical: space.xxl,
    },
    sheet: {
      width: '100%',
      maxWidth: 440,
      backgroundColor: color.glass,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: color.lineBright,
      padding: space.xl,
      gap: space.md,
      ...elevate(12),
      shadowColor: color.backdropCool,
      shadowOpacity: 0.45,
    },
    kicker: { fontFamily: font.display, fontSize: 13, letterSpacing: tracking.wide, color: color.ice },
    headline: { fontFamily: font.display, fontSize: 36, lineHeight: 38, color: color.text, letterSpacing: tracking.tight },
    body: { fontFamily: font.body, fontSize: 14, lineHeight: 20, color: color.silver },
    loading: { marginVertical: space.lg },
    note: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.silver },
    packs: { flexDirection: 'row', gap: space.md },
    pack: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: space.lg,
      borderRadius: radius.lg,
      backgroundColor: color.action,
      gap: 2,
    },
    packCount: { fontFamily: font.display, fontSize: 44, lineHeight: 46, color: color.onAction },
    packLabel: { fontFamily: font.label, fontSize: 13, letterSpacing: tracking.wide, color: color.onAction },
    packPrice: { fontFamily: font.bodyBold, fontSize: 15, color: color.onAction, marginTop: space.xs },
    soldElsewhere: {
      fontFamily: font.label,
      fontSize: 16,
      letterSpacing: tracking.normal,
      color: color.text,
      textAlign: 'center',
      paddingVertical: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.line,
    },
    message: { fontFamily: font.bodyBold, fontSize: 13, lineHeight: 19, color: color.text },
    rules: { gap: space.xs, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.md },
    ruleTitle: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide, color: color.textDim, marginTop: space.xs },
    rule: { fontFamily: font.body, fontSize: 12, lineHeight: 18, color: color.silver },
    close: {
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.lineBright,
    },
    closeLabel: { fontFamily: font.label, fontSize: 15, letterSpacing: tracking.wide, color: color.text },
  }),
);
