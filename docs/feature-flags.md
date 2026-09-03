# Feature flags and experiments

Toggles for controlling a feature after it has shipped, and A/B tests for
deciding between two versions of one. Both run on PostHog, which is already in
the app for analytics, so there is one vendor, one identity and one free tier.

```
apps/mobile/src/features/flags/
  registry.ts        every flag, declared. Pure — no React Native, so it is testable.
  index.ts           the runtime: resolution, cache, hooks, exposure.
  registry.test.ts   the rules, enforced. Breaking the pattern fails CI.
```

## Adding a flag

1. **Declare it** in `FLAGS` in `registry.ts`. The type demands a summary, an
   owner, a `removeBy` date and a fallback; an experiment additionally demands
   at least two arms, a `control`, and a metric that is a real `EventName`.
2. **Read it** where it is used: `useFlag('key')` in a component,
   `flag('key')` anywhere else. Keys are a union type, so a typo is a
   compile error and there is no string to get wrong.
3. **Create it in PostHog** with *exactly* the same key, and — for an
   experiment — exactly the same variant names. A mismatch is silent by
   design: an unrecognised value is discarded and the fallback stands.
4. **Run the tests.** `pnpm --filter @18-0/mobile test`.

```tsx
const enabled = useFlag('gameday');          // toggle  -> boolean
const copy = CTA_COPY[useFlag('gameday_cta')]; // experiment -> variant name
if (!enabled) return null;
```

## The one invariant

**A flag may never change what a roster scores.**

The product rests on a rating being deterministic: the same seven cards earn
the same record on every device, and the server recomputes it from its own rows
to prove nobody cheated. A flag inside that would mean two identical rosters
legitimately scoring differently, a leaderboard nobody could verify, and a
`score_disagreement` nobody could debug.

So flags reach the client's **surface** only — what is shown, what is offered,
what it is called. `packages/domain`, `packages/data` and `supabase/` contain
no flags, and `registry.test.ts` asserts that by reading the source tree.

The other half of the same rule: **the server is not flagged either.** Server
behaviour changes by migration and by its own data, which is on the audit trail
and reproducible a year later. Turning Gameday off in PostHog hides the marquee
and refuses the mode on the client; stopping it *server-side* means closing the
gameday rows, which is a data change and leaves a record. Two different tools
for two different jobs, on purpose.

## What is enforced, and why each rule exists

| Rule | The failure it prevents |
|---|---|
| Keys are lower snake_case and match their object key | PostHog and the code silently disagreeing |
| Summary and owner are required | The forty-flag codebase where three cannot be explained |
| `removeBy` must be in the future | A flag outliving its experiment forever. When this fails: delete it, ship the winner, or move the date deliberately |
| A toggle is boolean; an experiment has arms, a control and a metric | An experiment that cannot be analysed, or was analysed on whatever happened to move |
| The metric must be a real `EventName` | An experiment with no readable result |
| Every flag is read somewhere in the app | Residue from a half-finished change |
| No flag key or flag import in domain / data / supabase | The invariant above |
| At most twelve live flags | Configuration becoming a second product |

Each of those was checked by deliberately breaking it, not by reading the test.

## Resolution order

```
override   this device, from the operator console. QA and support.
remote     what PostHog said at the last successful evaluation.
fallback   what the build ships with.
```

`resolveFlag()` is pure, total, and the only path — so "why am I seeing this"
has exactly one answer, and the operator console prints it next to every flag.

Three properties worth knowing:

- **The fallback is the product, not a placeholder.** 18-0 plays with no
  account and no connection, and most sessions never ask a server anything. A
  flag whose fallback is not the shipping behaviour behaves one way in the
  office and another in the wild.
- **One evaluation per launch, then held.** Not to save a round trip — it is one
  small POST — but because an experiment whose variant can change under a
  player measures nothing, and a panel that rewords itself mid-read is a bug
  however correct the flag was.
- **The last answer survives a cold start**, at any age. A week-old cached flag
  is a better guess than pretending the experiment was never running.

Anything a value could be that the definition does not allow is discarded.
Remote configuration is untrusted input arriving from a web form, and it
outlives the build that reads it.

## How an experiment is actually measured

Two pieces of plumbing, both already done, both required:

- `$feature_flag_called` fires on the first read of each key per session. This
  is PostHog's exposure event and the denominator of every experiment result. A
  variant that is resolved but never reported cannot be analysed.
- `$feature/<key>` is attached to **every** event by `analytics.ts`. That is
  what makes the funnels that already exist — spins, picks, completions,
  retention — breakable down by variant with no new instrumentation.

Only flags off their fallback are reported: a flag sitting on the default is
the product, not a treatment.

In PostHog: create an Experiment over the flag, set the goal metric to the one
named in the registry, and read it there. `gameday_cta`'s goal is
`gameday_started`.

## The operator console

`/admin` lists every flag with its resolved value **and its source** —
`fallback`, `remote`, or `override`. Tapping cycles a flag through its allowed
values on that device and then back off the end, which clears the override.
Cycling is the only control on purpose: a text field would let somebody type a
variant that does not exist, and the runtime would discard it and look broken.

Overrides are device-local and persisted, for the case they exist for — "I
cannot reproduce the variant you are describing" is otherwise unanswerable when
assignment is server-side and sticky.

## Why PostHog rather than LaunchDarkly

The vendor supplies flag storage, targeting, percentage rollout and sticky
assignment. Everything in `registry.ts` — the typed keys, the expiry rule, the
invariant, the fallbacks — would be written on top of *any* vendor, and is
where the value of this pattern is.

PostHog wins here on four project-specific counts:

1. **It is already here.** Same key, same host, same `distinct_id`. Flags and
   experiments are on the free tier we already use for events. A second vendor
   means a second SDK, a second identity to reconcile, and another third party
   to disclose in a privacy policy that currently promises none.
2. **The metric events are here.** An A/B test is worth nothing without them.
   Assigning variants in one product and measuring them in another means
   forwarding the variant into PostHog anyway — which is exactly the
   `$feature/<key>` plumbing above, only now with two bills.
3. **One fetch, not a native SDK.** `analytics.ts` already refuses SDKs for
   this class of thing: a native dependency means rebuilding the iOS app to
   change vendor, plus a second code path for web. This is one POST, identical
   on all three platforms.
4. **Offline-first is a requirement, not an edge case.** "Fallbacks are the
   product" and "use the cache at any age" are deliberate choices here, and
   they are forty lines. An SDK's bootstrap behaviour would have to be audited
   into the same shape.

LaunchDarkly earns its price with many seats, approval workflows, complex
targeting and server-side flags across several services. None of that is true
of this repo today. Statsig and GrowthBook are the closer alternatives —
GrowthBook can even run against the Postgres already here — but both are still
a second vendor for metrics that already live in one.

**The vendor is isolated to one function.** `fetchRemoteFlags()` in
`analytics.ts` returns `Record<string, boolean | string> | null`. Swapping
PostHog for LaunchDarkly, Statsig, GrowthBook or a JSON file on a CDN is that
function and nothing else — the registry, the resolution order, the tests, the
console and every call site are unchanged. That, rather than the choice itself,
is the insurance.

## Removing a flag

The point of the whole thing.

1. Delete it from `FLAGS`.
2. Delete the branch it guarded, keeping the winner.
3. Archive the flag in PostHog.
4. `pnpm -r test` — the "every flag is read" and stale-key checks confirm
   nothing is left pointing at it.

A stale cached payload cannot resurrect a deleted flag: the runtime filters
anything it does not recognise on the way in.
