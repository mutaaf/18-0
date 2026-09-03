import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { color, elevate, font, radius, space, tracking, type PressState } from '@/theme';

/**
 * What it takes to get on the board, as two doors rather than a sentence.
 *
 * This used to be a grey paragraph explaining that only blind seasons from
 * signed-in players rank — which is the single most important thing on the
 * screen for anyone not yet on the board, written in the style of a footnote.
 * Nobody read it, and the two conditions are trivially satisfiable.
 *
 * So they are steps now: an icon each, a tick once you have done it, and one
 * button pointing at whichever one you still owe. The tick is the whole idea —
 * seeing one condition already met is what makes the other feel worth doing.
 */
export function RankGate({
  /** Signed in with a real account, not a device-only anonymous one. */
  named,
  /** The points board takes any season, so it only asks for the account. */
  requireBlind = true,
  heading,
}: {
  named: boolean;
  requireBlind?: boolean;
  heading?: string;
}) {
  const steps = [
    { key: 'account', icon: <PersonIcon />, title: 'Sign in', copy: 'Claim a name so a season can carry it.', done: named },
    ...(requireBlind
      ? [{
          key: 'blind',
          icon: <BlindIcon />,
          title: 'Play Player IQ',
          copy: 'Ratings hidden. On-screen ratings make it a reading test.',
          done: false,
        }]
      : []),
  ];

  const next = steps.find((s) => !s.done);

  return (
    <View style={[styles.card, elevate(6)]}>
      {/* The prize, drawn rather than described. */}
      <View style={styles.crest}>
        <TrophyIcon />
      </View>

      <Text style={styles.title}>{heading ?? 'Get on the board'}</Text>
      <Text style={styles.sub}>
        {requireBlind ? 'Two things. Both take a minute.' : 'One thing, and everything you have played already counts.'}
      </Text>

      <View style={styles.steps}>
        {steps.map((step) => (
          <View key={step.key} style={[styles.step, step.done && styles.stepDone]}>
            <View style={[styles.tile, step.done && styles.tileDone]}>
              {step.done ? <CheckIcon /> : step.icon}
            </View>
            <View style={styles.stepText}>
              <Text style={[styles.stepTitle, step.done && styles.stepTitleDone]}>{step.title}</Text>
              <Text style={styles.stepCopy}>{step.copy}</Text>
            </View>
            {step.done ? <Text style={styles.doneTag}>DONE</Text> : null}
          </View>
        ))}
      </View>

      <Pressable
        onPress={() => router.push(next?.key === 'account' ? '/(tabs)/account' : '/(tabs)')}
        accessibilityRole="button"
        accessibilityLabel={next?.key === 'account' ? 'Sign in' : 'Start a Player IQ season'}
        style={({ hovered, pressed }: PressState) => [
          styles.cta,
          hovered && { backgroundColor: color.redBright },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.ctaLabel}>
          {next?.key === 'account' ? 'Sign in' : 'Start a Player IQ season'}
        </Text>
        <ArrowIcon />
      </Pressable>
    </View>
  );
}

const STROKE = { strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function PersonIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5" stroke={color.text} {...STROKE} />
      <Path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" stroke={color.text} {...STROKE} />
    </Svg>
  );
}

/** An eye, closed. The mode is called Player IQ; the icon says why. */
function BlindIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" stroke={color.text} {...STROKE} />
      <Circle cx="12" cy="12" r="2.5" stroke={color.text} {...STROKE} />
      <Path d="M4 20L20 4" stroke={color.redBright} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function CheckIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12.5l4.5 4.5L19 7" stroke={color.positive} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function TrophyIcon() {
  return (
    <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
      <Path d="M7 4h10v5a5 5 0 0 1-10 0z" stroke={color.gold} {...STROKE} />
      <Path d="M7 5H4v2a3 3 0 0 0 3 3" stroke={color.gold} {...STROKE} />
      <Path d="M17 5h3v2a3 3 0 0 1-3 3" stroke={color.gold} {...STROKE} />
      <Path d="M12 17v4 M8 21h8" stroke={color.gold} {...STROKE} />
    </Svg>
  );
}

function ArrowIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h13 M13 6l6 6-6 6" stroke="#FFFFFF" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: `${color.red}59`,
    backgroundColor: '#12070AF2',
    padding: space.lg,
    gap: space.xs,
    overflow: 'hidden',
  },
  crest: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: `${color.gold}4D`,
    backgroundColor: `${color.gold}14`,
    marginBottom: space.xs,
  },
  title: {
    fontFamily: font.displayBlack,
    fontSize: 24,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  sub: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim },

  steps: { gap: space.sm, paddingTop: space.md, paddingBottom: space.md },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF08',
  },
  stepDone: { borderColor: `${color.positive}59`, backgroundColor: `${color.positive}14` },
  tile: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF1A',
    backgroundColor: '#FFFFFF0F',
  },
  tileDone: { borderColor: `${color.positive}66`, backgroundColor: `${color.positive}26` },
  stepText: { flex: 1, gap: 1 },
  stepTitle: { fontFamily: font.bodyBold, fontSize: 15, color: color.text },
  stepTitleDone: { color: color.textDim },
  stepCopy: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint },
  doneTag: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: color.positive,
  },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: color.red,
  },
  ctaLabel: {
    fontFamily: font.display,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: tracking.wide,
  },
});
