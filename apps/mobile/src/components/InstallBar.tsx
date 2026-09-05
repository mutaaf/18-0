import { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { usePathname } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import {
  dismissInstall,
  exportSeasons,
  importSeasons,
  installDismissed,
  installKind,
  isStandalone,
  onInstallAvailability,
  promptInstall,
  type InstallKind,
} from '@/features/install';
import { useHistoryStore } from '@/state/history';
import { DOCK_HEIGHT } from './Dock';
import { phoneBarHeight } from './NavBar';
import { color, elevate, font, radius, space, tracking, useLayout, type PressState } from '@/theme';


/**
 * Getting the game onto a home screen, and getting the seasons there with it.
 *
 * Deliberately a bar rather than a modal. An install prompt that covers the
 * game is an obstruction, and the thing being asked for -- put this somewhere
 * you can find it again -- only makes sense to somebody who has already seen
 * enough of it to want to. So it sits under the content, above the navigation,
 * and it goes away for good the first time it is dismissed.
 *
 * Three states, and only ever one of them:
 *
 *   1. Installable through the browser's own prompt (Chrome, Edge, Android).
 *      One button, which fires the real prompt.
 *   2. iOS, where installing is a menu item and no prompt exists. Instructions,
 *      with the actual Share glyph drawn rather than described, because "the
 *      share button" is not a thing people can find by name.
 *   3. Already installed, first run, and no seasons here. That is the case
 *      where somebody has just lost their history to iOS's separate storage,
 *      and it offers to bring it back.
 */
export function InstallBar() {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const pathname = usePathname();
  const games = useHistoryStore((s) => s.games);

  const [kind, setKind] = useState<InstallKind>('installed');
  const [dismissed, setDismissed] = useState(true);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [transferDone, setTransferDone] = useState(false);

  const refresh = useCallback(() => setKind(installKind()), []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    refresh();
    void installDismissed().then((was) => setDismissed(was));
    return onInstallAvailability(refresh);
  }, [refresh]);

  if (Platform.OS !== 'web') return null;

  // Standalone with nothing played: the one moment the transfer is worth
  // offering unprompted, because it is the moment the history went missing.
  const needsTransfer = isStandalone() && games.length === 0 && !transferDone;

  // The landing screen carries the "Get 18-0" panel, which makes the same offer
  // with room to explain it and the two stores beside it. Two install prompts
  // on one screen reads as nagging rather than as an offer, so the floating one
  // stands down there. The transfer prompt is a different message and still
  // shows, because losing a history is worth interrupting for.
  const landing = pathname === '/' || pathname.endsWith('/(tabs)');
  if (landing && !needsTransfer) return null;

  if (!needsTransfer && (dismissed || kind === 'installed' || kind === 'unsupported')) {
    return null;
  }

  const hide = () => {
    setDismissed(true);
    setOpen(false);
    void dismissInstall();
  };

  const copy = async () => {
    const payload = await exportSeasons();
    if (!payload) return setNote('Nothing to carry over yet.');
    await Clipboard.setStringAsync(payload).catch(() => undefined);
    setCopied(true);
    setNote(null);
    setTimeout(() => setCopied(false), 2500);
  };

  const paste = async () => {
    const text = code.trim() || (await Clipboard.getStringAsync().catch(() => ''));
    if (!text) return setNote('Copy the code in your browser first.');
    const result = await importSeasons(text);
    if (!result.ok) return setNote(result.error ?? 'That did not work.');
    setNote(`${result.seasons} seasons restored. Reopening…`);
    setTransferDone(true);
    // The store already read its persisted state at launch, so a reload is the
    // honest way to pick up what was just written underneath it.
    setTimeout(() => window.location.reload(), 700);
  };

  return (
    <View
      style={[
        styles.stage,
        // Asked, not guessed: the prompt sits on the bar rather than over
        // it, so it has to agree with the bar about where the bar ends.
        { bottom: layout.wide ? DOCK_HEIGHT : phoneBarHeight(insets.bottom) },
      ]}
      pointerEvents="box-none"
    >
      <View style={[styles.bar, elevate(8)]}>
        <View style={styles.row}>
          <View style={styles.mark}>
            {needsTransfer ? <BoxGlyph /> : <HomeGlyph />}
          </View>

          <View style={styles.copyBlock}>
            <Text style={styles.title}>
              {needsTransfer ? 'Bring your seasons over' : 'Put 18-0 on your home screen'}
            </Text>
            <Text style={styles.sub} numberOfLines={2}>
              {needsTransfer
                ? 'This device starts empty. Copy the code in your browser and paste it here.'
                : 'Opens full screen, plays offline, and keeps every season you have built.'}
            </Text>
          </View>

          {needsTransfer ? (
            <Action label="Paste" onPress={() => void paste()} primary />
          ) : kind === 'prompt' ? (
            <Action
              label="Install"
              primary
              onPress={() => void promptInstall().then((ok) => ok && hide())}
            />
          ) : (
            <Action label={open ? 'Hide' : 'How'} onPress={() => setOpen((was) => !was)} />
          )}

          {needsTransfer ? null : (
            <Pressable
              onPress={hide}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Dismiss the install prompt"
              style={styles.close}
            >
              <Text style={styles.closeGlyph}>✕</Text>
            </Pressable>
          )}
        </View>

        {/* iOS has no install prompt, so the only honest help is the exact
            sequence of taps -- with the glyph drawn, because nobody finds a
            control by the name a developer calls it. */}
        {open && kind === 'ios' ? (
          <View style={styles.steps}>
            <Step n="1" label="Tap" glyph={<ShareGlyph />} after="in the toolbar" />
            <Step n="2" label="Scroll to" after="Add to Home Screen" />
            <Step n="3" label="Tap" after="Add" />
            <Text style={styles.warn}>
              On iPhone an installed app gets its own storage, so seasons played here do not
              follow automatically. Copy them first and paste them on the first launch.
            </Text>
            <View style={styles.transferRow}>
              <Action label={copied ? 'Copied' : 'Copy my seasons'} onPress={() => void copy()} />
            </View>
          </View>
        ) : null}

        {needsTransfer ? (
          <View style={styles.steps}>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="Paste your transfer code"
              placeholderTextColor={color.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel="Transfer code"
            />
            <Text style={styles.warn}>
              Or sign in — every ranked season is on the server already and comes back with your
              account.
            </Text>
            <Pressable
              onPress={() => setTransferDone(true)}
              accessibilityRole="button"
              accessibilityLabel="Start fresh on this device"
              style={styles.skip}
            >
              <Text style={styles.skipLabel}>Start fresh instead</Text>
            </Pressable>
          </View>
        ) : null}

        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
    </View>
  );
}

function Step({
  n,
  label,
  glyph,
  after,
}: {
  n: string;
  label: string;
  glyph?: React.ReactNode;
  after: string;
}) {
  return (
    <View style={styles.step}>
      <Text style={styles.stepN}>{n}</Text>
      <Text style={styles.stepText}>{label} </Text>
      {glyph ? <View style={styles.stepGlyph}>{glyph}</View> : null}
      <Text style={styles.stepText}> {after}</Text>
    </View>
  );
}

function Action({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered, pressed }: PressState) => [
        styles.action,
        primary && styles.actionPrimary,
        hovered && { opacity: 0.88 },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text style={[styles.actionLabel, primary && styles.actionLabelPrimary]}>{label}</Text>
    </Pressable>
  );
}

/** iOS's share control, drawn to scale so it is recognisable at 16 points. */
function ShareGlyph() {
  return (
    <Svg width={15} height={17} viewBox="0 0 24 26" fill="none">
      <Path
        d="M12 2v14 M7.5 6.5L12 2l4.5 4.5"
        stroke={color.text}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6 10.5H4.5v12h15v-12H18"
        stroke={color.text}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function HomeGlyph() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Rect x="4" y="2.5" width="16" height="19" rx="3" stroke={color.redBright} strokeWidth={1.75} />
      <Path d="M9.5 18.5h5" stroke={color.redBright} strokeWidth={1.75} strokeLinecap="round" />
      <Path
        d="M12 7v6 M9 10l3 3 3-3"
        stroke={color.redBright}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function BoxGlyph() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z M3 7.5L12 12l9-4.5 M12 12v9"
        stroke={color.gold}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  stage: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 15 },
  bar: {
    width: '100%',
    maxWidth: 640,
    marginHorizontal: space.md,
    marginBottom: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: `${color.red}4D`,
    backgroundColor: '#0B0E17F5',
    padding: space.md,
    gap: space.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  mark: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF1A',
    backgroundColor: '#FFFFFF0A',
  },
  copyBlock: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontFamily: font.bodyBold, fontSize: 14, color: color.text },
  sub: { fontFamily: font.bodyRegular, fontSize: 11, lineHeight: 15, color: color.textFaint },

  action: {
    paddingVertical: 8,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF0A',
  },
  actionPrimary: { backgroundColor: color.red, borderColor: color.redBright },
  actionLabel: {
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: tracking.wide,
    color: color.textDim,
  },
  actionLabelPrimary: { color: '#FFFFFF' },

  close: { paddingHorizontal: 2 },
  closeGlyph: { fontFamily: font.body, fontSize: 15, color: color.textFaint },

  steps: { gap: 6, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.sm },
  step: { flexDirection: 'row', alignItems: 'center' },
  stepN: {
    fontFamily: font.label,
    fontSize: 10,
    color: color.redBright,
    width: 16,
  },
  stepText: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textDim },
  stepGlyph: { paddingHorizontal: 1 },
  warn: { fontFamily: font.bodyRegular, fontSize: 11, lineHeight: 15, color: color.gold },
  transferRow: { flexDirection: 'row', paddingTop: 2 },

  input: {
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: space.sm,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    backgroundColor: '#05070C',
  },
  skip: { alignSelf: 'flex-start', paddingVertical: 2 },
  skipLabel: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, color: color.textFaint },
  note: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textDim },
});
