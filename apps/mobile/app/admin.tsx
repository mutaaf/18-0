import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { DEFAULT_SCORING_CONFIG, ROSTER_SLOTS, type RosterSlot } from '@18-0/domain';
import { DATASET } from '@18-0/data';
import { Screen } from '@/components/Screen';
import { OperatorConsole } from '@/components/OperatorConsole';
import { amOperator } from '@/services/operator';
import { recentEvents, summarise } from '@/features/telemetry';
import {
  clearOverrides,
  flagDefinition,
  setOverride,
  useAllFlags,
  useFlagStatus,
  type FlagKey,
} from '@/features/flags';
import { useStatLineStatus } from '@/features/stat-lines';
import { useGameStore } from '@/state/game';
import { useHistoryStore } from '@/state/history';
import { useOverrideStore } from '@/state/overrides';
import { color, font, radius, space, tabular, tracking, useLayout, type PressState } from '@/theme';

/**
 * Operator console.
 *
 * Two things behind one door, gated differently on purpose.
 *
 * The live section is server-side and is the real thing: it reads through
 * definer-rights functions that check an operator list in the database, so an
 * account either is an operator or it is not, and nothing in this bundle can
 * change that answer. It opens on that check alone -- no PIN -- because the
 * PIN never protected it and a device without one would otherwise be locked
 * out of the only view of what is actually happening.
 *
 * The tuning tools below it are local and cannot be a security boundary:
 * anyone with the bundle can read the gate. They change this device's preview
 * scoring and nothing else -- the published model is a build-time artifact
 * (`packages/domain/src/constants/config.ts`) and ranked results are scored by
 * the server, which ignores every weight set here. So they keep the PIN, which
 * is the right amount of protection for a setting that affects one phone.
 */
const PIN = process.env.EXPO_PUBLIC_ADMIN_PIN;

export default function Admin() {
  const router = useRouter();
  const layout = useLayout();
  const [entered, setEntered] = useState('');
  const [unlocked, setUnlocked] = useState(__DEV__ && !PIN);
  const [pending, setPending] = useState<string | null>(null);

  // Asked once, answered by the server, and used only to decide what to draw.
  // Every function the console then calls checks it again on its own side.
  const [operator, setOperator] = useState(false);
  useEffect(() => {
    void amOperator().then(setOperator).catch(() => setOperator(false));
  }, []);

  const overrides = useOverrideStore();
  const history = useHistoryStore();
  const game = useGameStore();

  const summary = useMemo(() => summarise(), [unlocked, pending, history.games.length]);
  const events = useMemo(
    () => recentEvents(40).slice().reverse(),
    [unlocked, pending, history.games.length],
  );

  if (!unlocked && !operator) {
    return (
      <Screen>
        <View style={styles.lock}>
          <Text style={styles.lockTitle}>Operator console</Text>
          {PIN ? (
            <>
              <TextInput
                value={entered}
                onChangeText={setEntered}
                placeholder="PIN"
                placeholderTextColor={color.textFaint}
                secureTextEntry
                style={styles.pin}
                accessibilityLabel="Administrator PIN"
                onSubmitEditing={() => setUnlocked(entered === PIN)}
              />
              <Pressable
                onPress={() => setUnlocked(entered === PIN)}
                accessibilityRole="button"
                accessibilityLabel="Unlock console"
                style={styles.primary}
              >
                <Text style={styles.primaryLabel}>Unlock</Text>
              </Pressable>
              {entered.length > 0 && entered !== PIN ? (
                <Text style={styles.wrong}>Incorrect.</Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.lockCopy}>
              Set EXPO_PUBLIC_ADMIN_PIN to open this outside development.
            </Text>
          )}
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={styles.back}>← Back</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={layout.wide ? 960 : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerMain}>
            <Text style={styles.title}>Operator console</Text>
            <Text style={styles.subtitle}>
              Model {DEFAULT_SCORING_CONFIG.version} · dataset {DATASET.version} ·{' '}
              {DATASET.cards.length.toLocaleString()} cards
            </Text>
          </View>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        {operator ? <OperatorConsole /> : null}

        <FlagsSection />

        <StatLinesSection />

        <View style={styles.warn}>
          <Text style={styles.warnText}>
            Everything below this line is local preview only. It ships inside the app, so it is a
            tuning tool rather than a security boundary. Weight changes affect this device's preview
            score and nothing else — the published model is compiled into the build, and ranked
            results are scored by the server, which ignores everything here.
          </Text>
        </View>

        <Section title="Roster weights">
          <Text style={styles.help}>
            Slot weighting for this device's preview score. They should sum to 1.
          </Text>
          {ROSTER_SLOTS.map((slot) => (
            <WeightRow
              key={slot}
              slot={slot}
              value={overrides.rosterWeights[slot] ?? DEFAULT_SCORING_CONFIG.rosterWeights[slot]}
              onChange={(v) => overrides.setWeight(slot, v)}
            />
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text
              style={[
                styles.totalValue,
                Math.abs(overrides.total() - 1) > 0.001 && { color: color.negative },
              ]}
            >
              {overrides.total().toFixed(3)}
            </Text>
          </View>
          <ActionRow
            label="Restore the shipped weights"
            action="Reset"
            onPress={() => overrides.resetWeights()}
          />
        </Section>

        <Section title="Loop telemetry">
          <Text style={styles.help}>
            Recorded on this device for this session. Nothing is transmitted unless an analytics sink
            is configured.
          </Text>
          <Metric label="Events" value={String(summary.events)} />
          <Metric label="Spins" value={String(summary.spins)} />
          <Metric label="Picks" value={String(summary.picks)} />
          <Metric label="Rejected picks" value={String(summary.rejected)} />
          <Metric label="Dead-end spins" value={String(summary.deadEnds)} />
          <Metric label="Rigged spins" value={String(summary.riggedSpins)} />
          <Metric label="Games finished" value={String(summary.gamesFinished)} />
          <Metric
            label="Median time to pick"
            value={summary.medianPickSeconds === null ? '—' : `${summary.medianPickSeconds}s`}
          />
        </Section>

        <Section title="Recent events">
          {events.length === 0 ? (
            <Text style={styles.help}>Nothing recorded yet this session.</Text>
          ) : (
            events.map((e, i) => (
              <View key={`${e.at}-${i}`} style={styles.event}>
                <Text style={styles.eventName}>{e.name}</Text>
                <Text style={styles.eventProps} numberOfLines={1}>
                  {Object.entries(e.props)
                    .filter(([k]) => k !== 'dataset' && k !== 'model')
                    .map(([k, v]) => `${k}=${v}`)
                    .join('  ')}
                </Text>
              </View>
            ))
          )}
        </Section>

        <Section title="History">
          <Metric label="Saved games" value={String(history.games.length)} />
          <Metric label="Assisted runs" value={String(history.games.filter((g) => g.assisted).length)} />
          <Metric
            label="GM Mode runs"
            value={String(history.games.filter((g) => g.mode === 'player_iq').length)}
          />
          <ActionRow
            label="Remove assisted runs"
            action="Purge"
            onPress={() => {
              for (const g of history.games.filter((x) => x.assisted)) history.remove(g.id);
              setPending(null);
            }}
          />
          <ActionRow
            label="Clear every saved game"
            action={pending === 'history' ? 'Confirm' : 'Clear'}
            destructive
            onPress={() => {
              if (pending === 'history') {
                history.clear();
                setPending(null);
              } else setPending('history');
            }}
          />
          <ActionRow
            label="Abandon the game in progress"
            action="Abandon"
            destructive
            onPress={() => game.abandon()}
          />
        </Section>
      </ScrollView>
    </Screen>
  );
}

/**
 * Feature flags, and where each value came from.
 *
 * The point of showing the *source* is that "why am I seeing this" is the
 * question a flag system exists to make answerable and usually does not.
 * Fallback means the code decided, remote means PostHog decided, override
 * means this device is being made to lie -- which is exactly what you want
 * when a player is describing a variant you cannot reproduce.
 *
 * Tapping a flag cycles it through its allowed values and then back to
 * whatever the server says. Cycling is deliberately the only control: a free
 * text field would let somebody set a variant that does not exist, and the
 * runtime would then discard it silently and look broken.
 */
function FlagsSection() {
  const flags = useAllFlags();
  const status = useFlagStatus();
  const forced = flags.filter((f) => f.source === 'override').length;

  return (
    <Section title="Feature flags">
      <Text style={styles.help}>
        {status.ready
          ? status.fetchedAt
            ? 'Evaluated once at launch, from PostHog.'
            : status.cached
              ? 'Evaluated from the last cached answer — PostHog was not reachable.'
              : 'No remote answer. Every flag is on the value the build ships with.'
          : 'Evaluating…'}
        {forced > 0 ? ` ${forced} overridden on this device.` : ''}
      </Text>
      {flags.map((resolved) => {
        const definition = flagDefinition(resolved.key as FlagKey);
        const allowed: (boolean | string)[] =
          definition.kind === 'toggle' ? [true, false] : [...(definition.variants ?? [])];
        /**
         * One step along from whatever is showing now, and off the end of the
         * list clears the override.
         *
         * From the *current* value rather than from the head of the list: a
         * toggle sitting on its fallback of `true` was otherwise overridden to
         * `true` by the first tap, which changed the source chip and nothing
         * else and read as a broken button.
         */
        const next = () => {
          const index = allowed.findIndex((v) => v === resolved.value);
          void setOverride(resolved.key as FlagKey, allowed[index + 1] ?? null);
        };
        return (
          <Pressable
            key={resolved.key}
            onPress={next}
            accessibilityRole="button"
            accessibilityLabel={`${resolved.key} is ${String(resolved.value)} from ${resolved.source}. Change it on this device.`}
            style={({ hovered }: PressState) => [styles.flagRow, hovered && { opacity: 0.85 }]}
          >
            <View style={styles.flagMain}>
              <Text style={styles.flagKey}>{resolved.key}</Text>
              <Text style={styles.flagSummary}>{definition.summary}</Text>
              <Text style={styles.flagMeta}>
                {definition.kind} · {definition.owner} · remove by {definition.removeBy}
                {definition.metric ? ` · metric ${definition.metric}` : ''}
              </Text>
            </View>
            <View style={styles.flagValueBox}>
              <Text style={styles.flagValue}>{String(resolved.value)}</Text>
              <Text
                style={[
                  styles.flagSource,
                  resolved.source === 'override' && { color: color.ignitionBright },
                  resolved.source === 'remote' && { color: color.ice },
                ]}
              >
                {resolved.source}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <ActionRow
        label="Stop overriding flags on this device"
        action="Reset"
        onPress={() => void clearOverrides()}
      />
    </Section>
  );
}

/**
 * Whether this build's stat lines are the published ones.
 *
 * Display text is the one thing the app can correct without a release, so it is
 * also the one thing that can differ between two devices running what looks
 * like the same version. This says which revision the bundle shipped with,
 * which one the site is serving, and how many cards are being shown
 * differently as a result.
 */
function StatLinesSection() {
  const { checked, revision, corrected, bundled } = useStatLineStatus();
  return (
    <Section title="Stat lines">
      <Text style={styles.help}>
        {!checked
          ? 'Checking the published table…'
          : revision === null
            ? 'This build is current. Nothing is being corrected.'
            : `This build is behind. ${corrected} ${corrected === 1 ? 'card is' : 'cards are'} showing the published line instead of the bundled one.`}
      </Text>
      <Metric label="Bundled revision" value={bundled.slice(0, 12)} />
      <Metric label="Applied revision" value={revision ? revision.slice(0, 12) : '—'} />
      <Metric label="Cards corrected" value={String(corrected)} />
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ActionRow({
  label,
  action,
  destructive,
  onPress,
}: {
  label: string;
  action: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.actionRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${action}: ${label}`}
        style={({ hovered }: PressState) => [
          styles.action,
          destructive && styles.actionDestructive,
          hovered && { opacity: 0.85 },
        ]}
      >
        <Text style={[styles.actionLabel, destructive && { color: color.negative }]}>{action}</Text>
      </Pressable>
    </View>
  );
}

function WeightRow({
  slot,
  value,
  onChange,
}: {
  slot: RosterSlot;
  value: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(value.toFixed(3));
  return (
    <View style={styles.weightRow}>
      <Text style={styles.weightSlot}>{slot}</Text>
      <View style={styles.weightTrack}>
        <View style={[styles.weightFill, { width: `${Math.min(100, value * 300)}%` }]} />
      </View>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          const parsed = Number(t);
          if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) onChange(parsed);
        }}
        style={styles.weightInput}
        accessibilityLabel={`${slot} weight`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  lock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  lockTitle: { fontFamily: font.display, fontSize: 26, color: color.text },
  lockCopy: {
    fontFamily: font.bodyRegular,
    fontSize: 13,
    color: color.textDim,
    textAlign: 'center',
    maxWidth: 320,
  },
  pin: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 48,
    minWidth: 200,
    color: color.text,
    fontFamily: font.body,
    fontSize: 18,
    textAlign: 'center',
  },
  primary: {
    backgroundColor: color.red,
    borderRadius: radius.md,
    paddingHorizontal: space.xxl,
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryLabel: {
    fontFamily: font.display,
    fontSize: 16,
    color: '#fff',
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
  },
  wrong: { fontFamily: font.body, fontSize: 13, color: color.negative },
  back: { fontFamily: font.body, fontSize: 14, color: color.textFaint },

  scroll: { padding: space.xl, paddingBottom: 140, gap: space.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerMain: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.display, fontSize: 32, color: color.text },
  subtitle: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint },
  close: {
    fontFamily: font.body,
    fontSize: 18,
    color: color.textDim,
    minWidth: 44,
    minHeight: 44,
    lineHeight: 44,
    textAlign: 'center',
  },

  warn: {
    borderWidth: 1,
    borderColor: '#FFB40040',
    backgroundColor: '#FFB4000D',
    borderRadius: radius.md,
    padding: space.lg,
  },
  warnText: { fontFamily: font.bodyRegular, fontSize: 12.5, color: color.textDim, lineHeight: 18 },

  section: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
    backgroundColor: '#FFFFFF04',
  },
  sectionTitle: {
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
    marginBottom: space.xs,
  },
  help: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint, lineHeight: 17 },

  flagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  flagMain: { flex: 1, gap: 2 },
  flagKey: { fontFamily: font.label, fontSize: 13, color: color.text },
  flagSummary: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textDim, lineHeight: 16 },
  flagMeta: { fontFamily: font.bodyRegular, fontSize: 10, color: color.textFaint },
  flagValueBox: { alignItems: 'flex-end', minWidth: 84 },
  flagValue: { fontFamily: font.display, fontSize: 15, color: color.text },
  flagSource: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textFaint,
  },

  metric: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  metricLabel: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim, flex: 1 },
  metricValue: { fontFamily: font.display, fontSize: 16, color: color.text, ...tabular },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: 4,
  },
  action: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
    minHeight: 40,
    justifyContent: 'center',
  },
  actionDestructive: { borderColor: '#FF6B6B59' },
  actionLabel: {
    fontFamily: font.label,
    fontSize: 13,
    letterSpacing: tracking.wide,
    color: color.text,
  },

  weightRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 5 },
  weightSlot: { fontFamily: font.label, fontSize: 12, color: color.silver, width: 42 },
  weightTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF0F',
    overflow: 'hidden',
  },
  weightFill: { height: 6, backgroundColor: color.red },
  weightInput: {
    width: 76,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    minHeight: 36,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    textAlign: 'right',
  },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: color.line,
    paddingTop: space.sm,
    marginTop: space.xs,
  },
  totalLabel: {
    fontFamily: font.label,
    fontSize: 12,
    color: color.textFaint,
    letterSpacing: tracking.wide,
  },
  totalValue: { fontFamily: font.display, fontSize: 16, color: color.text, ...tabular },

  event: { flexDirection: 'row', gap: space.md, paddingVertical: 3 },
  eventName: { fontFamily: font.label, fontSize: 11, color: color.silver, width: 152 },
  eventProps: { flex: 1, fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
});
