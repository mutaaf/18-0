import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { APP_URL } from '@/features/links';
import { track } from '@/features/telemetry';
import { offerSeasonTransfer, transferableSeasons } from '@/services/supabase';
import { color, font, radius, space, themed, tracking, type PressState } from '@/theme';

/**
 * Taking the seasons you played in a frame back to your own account.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS CLOSES
 * ---------------------------------------------------------------------------
 *
 * A season played in a frame is dealt and scored by the server and is provable,
 * and it is still on an *anonymous* account -- which every public board leaves
 * off on purpose, because an anonymous account is free and unlimited. So the
 * seasons were real and had nowhere to go.
 *
 * Worse, the account they are on cannot be signed into from here: the frame is
 * play-only by design, because a sign-in inside a box somebody else positions
 * is the clickjacking target that made `/embed` a separate surface in the first
 * place. And the browser partitions a third-party frame's storage by the page
 * holding it, so the account in this frame is not the account on 18-0.co even
 * though both are the same origin.
 *
 * 0022 already solved the general shape of this -- a short-lived, single-use
 * ticket, minted by the account holding the seasons and redeemed by the account
 * that wants them. What was missing was a way for the ticket to cross.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LEAVES IN A NEW TAB AND NOT IN A MESSAGE
 * ---------------------------------------------------------------------------
 *
 * The frame already talks to its host with `postMessage`, and that is the
 * obvious carrier. It cannot be this one. A message to the parent window is
 * delivered to every listener in that page -- the site's own scripts and every
 * third-party tag on it -- and this ticket is a bearer capability: whoever
 * holds it takes the seasons. Naming a target origin does not help; that
 * restricts who may read the origin, not which listeners fire.
 *
 * So the player opens a tab themselves and the ticket rides in the address bar,
 * which is the magic-link shape and is safe for the reasons a magic link is:
 * single-use, thirty minutes, minting another expires the first, and the
 * account that minted it may not claim it. `transferFromUrl` takes it out of
 * the address bar as soon as it has been read.
 */
export function CarryOver() {
  const [seasons, setSeasons] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void transferableSeasons()
      .then((t) => live && setSeasons(t?.eligible ? t.seasons : 0))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const carry = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const ticket = await offerSeasonTransfer();
      if (!ticket) {
        setFailed(true);
        return;
      }
      track('app_link_opened', { target: 'carry_over' });
      // `_blank`, and a *top-level* tab: the whole point is to land outside the
      // partition this frame is sitting in. Opened from the press so the
      // gesture is still the player's and no popup blocker is involved.
      window.open(`${APP_URL}/account?transfer=${encodeURIComponent(ticket)}`, '_blank', 'noopener');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  // Nothing to carry, or a server that never answered. Either way there is no
  // offer worth making -- a button that mints a ticket for no seasons is a
  // button that spends somebody's attention on nothing.
  if (seasons === 0) return null;

  return (
    <View style={styles.root}>
      <Text style={styles.line}>
        <Text style={styles.count}>{seasons}</Text>
        {seasons === 1 ? ' season here is' : ' seasons here are'} not on the board yet.
      </Text>
      <Text style={styles.why}>
        They were played without an account. Sign in on 18-0.co and they go up together.
      </Text>
      <Pressable
        onPress={() => void carry()}
        disabled={busy}
        accessibilityRole="link"
        accessibilityLabel="Take these seasons to your account on 18-0.co"
        style={({ hovered, pressed }: PressState) => [
          styles.go,
          hovered && styles.goHover,
          pressed && { opacity: 0.9 },
        ]}
      >
        <Text style={styles.goLabel}>
          {busy ? 'Opening…' : 'Take them to my account'}
        </Text>
      </Pressable>
      {failed ? (
        <Text style={styles.failed}>
          Could not reach the server. The seasons are safe here; try again.
        </Text>
      ) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: {
    gap: 4,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.lineGold,
    backgroundColor: color.goldGlow,
  },
  line: { fontFamily: font.bodyRegular, fontSize: 12.5, color: color.text },
  count: { fontFamily: font.bodyBold, color: color.gold },
  why: { fontFamily: font.bodyRegular, fontSize: 11, lineHeight: 16, color: color.textFaint },
  go: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
    marginTop: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.action,
    borderWidth: 1,
    borderColor: color.actionBright,
  },
  goHover: { backgroundColor: color.actionBright },
  goLabel: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.onAction,
  },
  failed: { fontFamily: font.bodyRegular, fontSize: 11, color: color.gold, marginTop: 4 },
}));
