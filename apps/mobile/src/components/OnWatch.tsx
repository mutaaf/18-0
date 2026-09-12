import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Panel } from './Panel';
import { EXTENSION_URL, EXTENSION_ZIP_URL, agentPrompt } from '@/features/links';
import { track } from '@/features/telemetry';
import { color, font, radius, space, themed, tracking, type PressState } from '@/theme';

/**
 * The game, put into somebody else's page — and how to do that yourself.
 *
 * **Web only**, like `GetTheApp`, and for the same reason: the same React ships
 * inside the iOS and Android builds, and a panel explaining how to load a
 * desktop Chrome extension is nonsense to read on a phone that cannot.
 *
 * ---------------------------------------------------------------------------
 * TWO ROUTES, BECAUSE THERE ARE TWO KINDS OF READER
 * ---------------------------------------------------------------------------
 *
 * Everything about an unpacked extension is unfamiliar to somebody who has
 * never opened `chrome://extensions` — including that such a page exists. So
 * one route is the four steps, written out, with nothing assumed and the exact
 * words that appear on Chrome's own screen.
 *
 * The other is a prompt. Handing an agent "clone this and set it up" is how a
 * growing number of people install anything, and the instruction has to name
 * the repository, the folder inside it and the page to open — an agent given
 * "install the 18-0 extension" will guess at all three.
 *
 * **What it must not do is pretend to be a store.** There is no listing and no
 * one-click install; this is a demo loaded unpacked. Saying so plainly is the
 * difference between a route somebody can follow and a button that disappoints.
 */
export function OnWatch() {
  const [copied, setCopied] = useState(false);

  // Inside a native build there is no Chrome to load anything into.
  if (Platform.OS !== 'web') return null;

  const open = (url: string, what: string) => {
    track('app_link_opened', { target: what });
    Linking.openURL(url).catch(() => {});
  };

  const copy = () => {
    track('app_link_opened', { target: 'watch_extension_prompt' });
    try {
      void navigator.clipboard?.writeText(agentPrompt()).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } catch {
      // A browser that refuses the clipboard still shows the prompt above, and
      // selecting it by hand is the fallback that has always existed.
    }
  };

  return (
    <Panel tint={color.navy} contentStyle={styles.body}>
      <Text style={styles.eyebrow}>Beyond this page</Text>
      <Text style={styles.title}>Put 18-0 on your ESPN Watch page</Text>
      <Text style={styles.lede}>
        A browser extension drops the game into a row on espn.com/watch — a card
        among the thumbnails, or a band across the gap between two rows. It sits
        in the page's own grid, moves on the row's clock, and plays right there.
      </Text>

      <View style={styles.routes}>
        <View style={styles.route}>
          <Text style={styles.routeName}>Do it yourself</Text>
          <Text style={styles.routeHint}>Four steps, about a minute. Chrome or Edge. 194K.</Text>
          {[
            'Download the extension and unzip it.',
            'Open chrome://extensions and turn on Developer mode, top right.',
            'Press “Load unpacked” and choose extensions/espn-watch inside the folder.',
            'Go to espn.com/watch. The card is in the first row.',
          ].map((step, index) => (
            <View key={step} style={styles.step}>
              <Text style={styles.stepNumber}>{index + 1}</Text>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
          <Pressable
            onPress={() => open(EXTENSION_ZIP_URL, 'watch_extension_zip')}
            accessibilityRole="link"
            accessibilityLabel="Download the 18-0 on Watch extension"
            style={({ hovered, pressed }: PressState) => [
              styles.action,
              hovered && styles.actionHover,
              pressed && { opacity: 0.9 },
            ]}
          >
            <Svg width={13} height={13} viewBox="0 0 24 24">
              <Path d="M12 3v10m0 0l-4-4m4 4l4-4M4 19h16" stroke={color.onAction} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={styles.actionLabel}>Download the extension</Text>
          </Pressable>
        </View>

        <View style={styles.route}>
          <Text style={styles.routeName}>Ask your AI to do it</Text>
          <Text style={styles.routeHint}>
            Paste this into Claude Code, or any agent that can use your computer.
          </Text>
          <View style={styles.promptBox}>
            <Text style={styles.prompt} selectable>
              {agentPrompt()}
            </Text>
          </View>
          <Pressable
            onPress={copy}
            accessibilityRole="button"
            accessibilityLabel="Copy the prompt"
            style={({ hovered, pressed }: PressState) => [
              styles.ghost,
              hovered && styles.ghostHover,
              pressed && { opacity: 0.9 },
            ]}
          >
            <Text style={styles.ghostLabel}>{copied ? 'Copied' : 'Copy the prompt'}</Text>
          </Pressable>
        </View>
      </View>

      {/*
        Said once, plainly. It is not in a store, it is not signed, and it is
        loaded the way a developer loads one -- somebody who reads that after
        following four steps has been misled by the four steps.
      */}
      <Text style={styles.note}>
        It is a demo, loaded unpacked — not a published extension. It reads
        nothing but the page's own layout, counts what it shows on your machine
        and sends it nowhere, and adds no club or league marks.{' '}
        <Text
          style={styles.noteLink}
          onPress={() => open(EXTENSION_URL, 'watch_extension_repo')}
          accessibilityRole="link"
        >
          How it works
        </Text>
      </Text>
    </Panel>
  );
}

const styles = themed(() => StyleSheet.create({
  body: { gap: space.md },
  eyebrow: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.actionBright,
  },
  title: { fontFamily: font.heading, fontSize: 21, color: color.text },
  lede: {
    fontFamily: font.bodyRegular,
    fontSize: 13,
    lineHeight: 19,
    color: color.textDim,
    maxWidth: 620,
  },

  // Side by side where there is room, stacked where there is not. `rowGap`
  // rather than a margin, so the stacked case does not double its spacing.
  routes: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: space.xs },
  route: {
    flexGrow: 1,
    flexShrink: 1,
    // A basis wide enough that two of them only sit side by side when both fit
    // without squeezing the numbered steps into two lines each.
    flexBasis: 300,
    minWidth: 0,
    gap: 6,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF06',
  },
  routeName: { fontFamily: font.bodyBold, fontSize: 14, color: color.text },
  routeHint: {
    fontFamily: font.bodyRegular,
    fontSize: 12,
    lineHeight: 17,
    color: color.textFaint,
    marginBottom: 4,
  },

  step: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  stepNumber: {
    fontFamily: font.label,
    fontSize: 10,
    lineHeight: 17,
    color: color.actionBright,
    width: 12,
  },
  stepText: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.bodyRegular,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.textDim,
  },

  promptBox: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#00000055',
    padding: space.sm,
    marginTop: 2,
  },
  prompt: {
    // There is no monospace face in the palette, and adding one for a block
    // somebody copies rather than reads would be a font download for nothing.
    fontFamily: font.bodyRegular,
    fontSize: 11,
    lineHeight: 16,
    color: color.silver,
  },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 38,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.action,
    borderWidth: 1,
    borderColor: color.actionBright,
  },
  actionHover: { backgroundColor: color.actionBright },
  actionLabel: {
    fontFamily: font.label,
    fontSize: 11.5,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.onAction,
  },

  ghost: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
  },
  ghostHover: { borderColor: color.actionBright },
  ghostLabel: {
    fontFamily: font.label,
    fontSize: 11.5,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.text,
  },

  note: {
    fontFamily: font.bodyRegular,
    fontSize: 11.5,
    lineHeight: 17,
    color: color.textFaint,
    maxWidth: 640,
  },
  noteLink: { color: color.actionBright },
}));
