/**
 * Every flag in 18-0, declared in one file.
 *
 * A flag is a promise to remove a flag. The failure mode of this pattern is
 * never the first one -- it is the fortieth, three of which nobody can explain
 * and one of which is load-bearing. So the registry is the only way to make a
 * flag, and it demands the four things that make one removable later: what it
 * controls, who decides, when it goes, and what ships when nothing is
 * reachable. `registry.test.ts` fails the build when any of that is missing or
 * out of date, which is what makes this a mechanism rather than a document.
 *
 * Deliberately free of React Native imports. The registry is data and pure
 * functions, so it can be tested in a node environment, and the runtime that
 * needs storage, a network and hooks lives next door in `index.ts`.
 *
 * ---------------------------------------------------------------------------
 * THE ONE INVARIANT
 * ---------------------------------------------------------------------------
 *
 * **A flag may never change what a roster scores.**
 *
 * The whole product rests on a rating being deterministic: the same seven cards
 * earn the same record on every device, forever, and the server recomputes it
 * to prove nobody cheated. A flag inside that would mean two players' identical
 * rosters legitimately scoring differently, an unreproducible leaderboard, and
 * a `score_disagreement` nobody could debug.
 *
 * So flags live in `apps/mobile` and reach the *surface* only -- what is shown,
 * what is offered, what it is called. `packages/domain`, `packages/data` and
 * `supabase/` contain no flags at all, and the test asserts it by reading the
 * source tree. Server behaviour is changed by migrations and by its own data,
 * which is auditable; the client's surface is changed by these, which is fast.
 * That split is the point, not an accident of where the code happened to go.
 */

export type FlagKind = 'toggle' | 'experiment';

/** Where a resolved value came from. Shown in the operator console. */
export type FlagSource = 'override' | 'remote' | 'fallback';

export interface FlagDefinition {
  /** The key as it is spelled in PostHog. Lower snake_case. */
  readonly key: string;
  /**
   * `toggle` is on or off and someone decides. `experiment` is a variant and
   * the *data* decides -- which is why it also has to name a metric.
   */
  readonly kind: FlagKind;
  /** One line: what changes when this moves. */
  readonly summary: string;
  /** Who decides this flag's fate. A person, not a team. */
  readonly owner: string;
  /**
   * The date this flag stops being allowed to exist, `YYYY-MM-DD`.
   *
   * Not advisory: `registry.test.ts` fails once it passes, so the build itself
   * asks for the decision. Extending it is a one-line edit and an honest one;
   * a flag quietly outliving its experiment is neither.
   */
  readonly removeBy: string;
  /**
   * What ships when nothing is reachable -- no key configured, no network, a
   * cold start on a plane, PostHog having an afternoon.
   *
   * This is the real default of the product, not a placeholder. The game is
   * offline-first and most sessions never ask a server anything, so a flag
   * whose fallback is not the shipping behaviour is a flag that behaves one way
   * in the office and another way in the wild.
   */
  readonly fallback: boolean | string;
  /** Experiments only. Must contain `control`, which is what fallback is. */
  readonly variants?: readonly string[];
  /**
   * Experiments only: the event this is trying to move.
   *
   * An experiment without a stated metric is a coin toss you pay for. Naming
   * it here means the analysis is decided before the data arrives, rather than
   * chosen afterwards from whichever number happened to move.
   */
  readonly metric?: string;
}

/**
 * The flags.
 *
 * Keep this list short. Two is a mechanism; twenty is a second product with no
 * tests, and the `removeBy` dates are what stop the second one happening.
 */
export const FLAGS = {
  /**
   * Gameday, on or off.
   *
   * The kill switch this whole mechanism was built for. Gameday is the newest
   * and least proven thing in the game: it depends on a generated calendar, a
   * migration, a trigger and a board, and it is the only mode whose
   * availability changes by itself. If any of that misbehaves on a Sunday
   * afternoon, the alternative to a toggle is an App Store review.
   *
   * Off hides the marquee and refuses entry to the mode. It does not touch a
   * game already in progress, and it does not touch the server: a *server-side*
   * stop is closing the gameday rows, which is a data change and on the trail.
   * See `docs/gameday.md`.
   */
  gameday: {
    key: 'gameday',
    kind: 'toggle',
    summary: 'Offers Gameday at all. Off hides the marquee and refuses the mode.',
    owner: 'mutaaf',
    removeBy: '2027-03-01',
    fallback: true,
  },

  /**
   * What the gameday marquee says.
   *
   * The panel is the only place in the game that has to convert on a deadline
   * -- the window closes and the board settles -- and there is no reason to
   * believe the first wording chosen is the one that gets people through the
   * turnstile. Three readings of the same offer:
   *
   *   control   "Enter Gameday"     -- the plain invitation
   *   clock     "Play before kickoff" -- the deadline is the reason
   *   field     "Today's 26 teams"    -- the restricted wheel is the reason
   *
   * Nothing about the game changes: same wheel, same visibility, same board,
   * same scoring. Only the words on the door.
   */
  gameday_cta: {
    key: 'gameday_cta',
    kind: 'experiment',
    summary: 'Wording of the gameday marquee and its call to action.',
    owner: 'mutaaf',
    removeBy: '2026-12-01',
    fallback: 'control',
    variants: ['control', 'clock', 'field'],
    metric: 'gameday_started',
  },
  /**
   * Player photographs, on or off.
   *
   * Not a product decision -- a legal one, kept where it can be made in
   * seconds. `headshots.ts` carries 1,626 URLs on the NFL's CDN and its own
   * header says the images "are not ours to redistribute". They were pulled to
   * prove a point when nothing was public; the app is now installable, and the
   * exposure is larger than the trademark question the codebase already takes
   * seriously enough to refuse club names over.
   *
   * If a takedown arrives, this turns every photograph off everywhere that can
   * reach PostHog, in the time it takes to click a toggle, with no App Store
   * review in the path. `CollectibleCard` has degraded gracefully since the
   * first build -- `{photo ? … : null}`, leaving the team-coloured wash -- and
   * every team defence card has run without a photo in production all along,
   * so the off state is the proven one.
   *
   * A device that cannot reach PostHog keeps its shipped default of `true`,
   * which is the usual limit of a remote switch. It matters less here than it
   * looks: a photograph is fetched from the CDN when a card is opened, so a
   * device with no network is not displaying them either.
   *
   * `removeBy` is the date by which the underlying decision has to be made
   * rather than deferred again: licence a source, generate something that is
   * ours, or remove them. A switch is a stay of execution, not an answer.
   */
  player_photos: {
    key: 'player_photos',
    kind: 'toggle',
    summary: 'Shows player photographs on a card. Off leaves the team-coloured wash.',
    owner: 'mutaaf',
    removeBy: '2027-09-01',
    fallback: true,
  },
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAGS;

/** Every definition, for the console and the tests. */
export const FLAG_LIST: readonly FlagDefinition[] = Object.values(FLAGS);

/**
 * One definition, widened to the interface.
 *
 * `as const satisfies` above buys exact literal types for `FlagKey` and
 * `FlagValue`, at the cost of every optional field vanishing from the union --
 * a reader of `FLAGS.gameday` cannot even ask about `metric`. This is the way
 * to read a definition as a definition.
 */
export const flagDefinition = (key: FlagKey): FlagDefinition => FLAGS[key];

export const flagKeys = (): FlagKey[] => Object.keys(FLAGS) as FlagKey[];

/** The value a flag can take, narrowed from its own definition. */
export type FlagValue<K extends FlagKey> = (typeof FLAGS)[K] extends { variants: readonly (infer V)[] }
  ? V
  : boolean;

export interface Resolved<K extends FlagKey = FlagKey> {
  readonly key: K;
  readonly value: FlagValue<K>;
  readonly source: FlagSource;
}

/**
 * Is this a value the definition actually allows?
 *
 * Remote configuration is untrusted input. A toggle handed a string, or an
 * experiment handed a variant somebody typed into a web form an hour ago, is a
 * blank panel or a crash on a phone that has already shipped -- so a value that
 * does not fit the definition is discarded and the fallback stands. This is the
 * difference between a flag system and a remote code path.
 */
export function isValidValue(definition: FlagDefinition, value: unknown): boolean {
  if (definition.kind === 'toggle') return typeof value === 'boolean';
  return typeof value === 'string' && (definition.variants ?? []).includes(value);
}

/**
 * What a flag means when the server answered and did not mention it.
 *
 * Off. A toggle is `false`; an experiment is its control arm, which is the
 * untreated version and therefore the right thing to show somebody who is not
 * in the experiment.
 */
function inactive(definition: FlagDefinition): boolean | string {
  return definition.kind === 'experiment' ? 'control' : false;
}

/**
 * The resolution order, and the whole of it.
 *
 *   override        a device-local decision, from the operator console. QA and
 *                   support, so somebody can reproduce a variant on demand.
 *   remote, present what PostHog said.
 *   remote, absent  PostHog answered and did not mention this flag, which is
 *                   how it reports one that is switched off -- so: off.
 *   fallback        nobody answered. What the code ships with.
 *
 * **The distinction between the last two is the kill switch.** PostHog omits a
 * disabled flag from `/decide` rather than returning it as `false`, so an
 * answered-but-absent key used to be indistinguishable from silence and both
 * resolved to the shipped default. `gameday` ships as `true`, which meant
 * switching it off in the console did nothing at all: the one thing the flag
 * existed for was the one thing it could not do.
 *
 * `null` still means silence, and silence still means the fallback -- that is
 * the offline-first promise and it is unchanged. It is only a *successful*
 * empty answer that now counts as an answer.
 *
 * The cost is worth naming: if the project were ever pointed at a PostHog that
 * answers 200 with no flags -- a rotated key, a fresh project -- every flag
 * would read as off rather than as shipped. That is the correct reading of a
 * successful answer, and it is why `fetchRemoteFlags()` returns `null` rather
 * than `{}` for every failure it can detect, including having no key at all.
 *
 * Pure and total: it cannot throw, and it always returns a value the
 * definition allows. Every caller in the app goes through this, so there is
 * exactly one answer to "why am I seeing this".
 */
export function resolveFlag(
  definition: FlagDefinition,
  remote: Record<string, unknown> | null,
  overrides: Record<string, unknown> | null,
): { value: boolean | string; source: FlagSource } {
  const override = overrides?.[definition.key];
  if (override !== undefined && isValidValue(definition, override)) {
    return { value: override as boolean | string, source: 'override' };
  }
  if (remote !== null) {
    const value = remote[definition.key];
    // Answered, and did not mention this flag: switched off.
    if (value === undefined) return { value: inactive(definition), source: 'remote' };
    if (isValidValue(definition, value)) {
      return { value: value as boolean | string, source: 'remote' };
    }
    // Answered with something unusable -- a variant renamed in a web form an
    // hour ago, a toggle set to a string. That is a misconfiguration rather
    // than a decision, so the build's own default stands.
    return { value: definition.fallback, source: 'fallback' };
  }
  return { value: definition.fallback, source: 'fallback' };
}

/** Resolve everything at once, for the console and for event properties. */
export function resolveAll(
  remote: Record<string, unknown> | null,
  overrides: Record<string, unknown> | null,
): Resolved[] {
  return FLAG_LIST.map((definition) => ({
    key: definition.key as FlagKey,
    ...resolveFlag(definition, remote, overrides),
  })) as Resolved[];
}
