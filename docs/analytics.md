# Product analytics

Two different questions, two different tools, and they are not
interchangeable.

**"What is the server doing right now?"** — the operator console at `/admin`.
Who is playing, what they have finished, what got refused in the last hour,
p95 latency, the audit trail as it happens, and the actions that go with it:
hide a handle, void a season, delete an account. This reads Postgres directly
and is the source of truth for game state. It is already live and costs
nothing.

**"Do people who try Scout come back next week?"** — product analytics. That
is a question about people over time, and the answer is a retention curve, a
funnel and a cohort, none of which a table of rows answers well.

## Why not Datadog or New Relic

Both are infrastructure APM: hosts, traces, spans, error rates. Neither
profiles a *player*, which is the thing actually being asked for. Their free
tiers are also the wrong shape for this — Datadog's keeps metrics for one day
and does not usefully retain logs; New Relic's 100 GB/month is generous but
still buys APM, not funnels.

And the integration is not simpler than what exists. Shipping from Supabase
Edge Functions (Deno) means a hand-written HTTP shipper either way, and the
dashboards would then live in a third place while the actions stayed in the
app.

## PostHog, over the HTTP API

Free tier: 1M events/month, unlimited team members, person profiles, funnels,
retention, cohorts, feature flags. `src/features/analytics.ts` talks to the
capture API with `fetch` rather than using `posthog-react-native`, on purpose:

- the RN SDK is a native dependency, so swapping analytics vendors would mean
  rebuilding and reinstalling the iOS app
- one `fetch` behaves identically on web, iOS and Android — no second code path
- it sends only the fields written in that file, which is auditable by reading
  one screen of code

The cost is autocapture and session replay, neither of which is worth much for
a game whose whole loop is already instrumented event by event.

It hangs off the `setSink` hook that `features/telemetry.ts` has always had, so
every existing `track()` call is already wired. No call sites changed.

## Configuration

Live. PostHog project `402075`, **US Cloud** — the account was already on the
US region, and region is fixed per account, so the EU host is not an option
without a second account.

| Where | Name | Value |
| --- | --- | --- |
| `apps/mobile/.env` (untracked) | `EXPO_PUBLIC_POSTHOG_KEY` | `phc_…` project token |
| | `EXPO_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` |
| GitHub repo **variables** | `POSTHOG_KEY`, `POSTHOG_HOST` | same, for the Pages build |
| Supabase **secrets** | `POSTHOG_PERSONAL_API_KEY` | `phx_…`, scoped `person:write` on this project only |
| | `POSTHOG_PROJECT_ID`, `POSTHOG_HOST` | for the deletion call |

The project token is a repository *variable*, not a secret: PostHog's own
settings page calls it "write-only, safe to use in public apps" — it can send
events and read nothing back. The **personal** key is a real secret, lives only
in Supabase secrets, and is scoped to `person:write` on this one project so the
worst it can do is delete analytics people.

With no `EXPO_PUBLIC_POSTHOG_KEY`, no sink is installed and no request is made.

## Deletion

`delete-account` calls PostHog's `persons/bulk_delete/` with the account id in
the same request that deletes the account. The client aliases the anonymous
device id onto the account id at identify time, so deleting one takes the
anonymous history with it.

It never fails the deletion: by the time it runs the account is already gone,
and refusing would leave the player believing it had not worked. The outcome —
`ok`, `not_configured`, `http_403`, whatever it was — goes on the audit trail
under `account_deleted`, where a failure can be seen and retried.

## Rules and regs — done, and still to do

**Done:**

- `digitalcraftai.com/privacy` rewritten. It previously said, in three places,
  that the game runs no analytics. It now names PostHog as a processor, says
  what is sent and what never is, says the data sits in the US, and states that
  deleting an account deletes the analytics too — which is true because the
  function above makes it true.
- The same page's "Delete my account" instructions said *the leaderboard
  screen*. That moved to the Account tab; a policy that sends someone to the
  wrong screen to exercise a right is a broken policy.

**Still to do, and neither can be done from here:**

1. **App Store privacy disclosures** (App Store Connect → App Privacy). Declare
   *Usage Data → Product Interaction → Analytics* and *Identifiers → User ID →
   Analytics*, both **linked to the user**, **not used for tracking**. It is
   first-party analytics, so no ATT prompt is required — but adding any
   advertising SDK later changes that answer, because combining the two is
   what makes it tracking.
2. **Google Play Data safety form.** Same declaration, separate form: App
   activity → App interactions, and Device or other IDs. Collected, not shared,
   and say deletion is available in-app.

## What is deliberately never sent

- No email, and no auth provider identity
- No roster, and no card ids — those are the answer sheet
- Ratings as bands (`93-96`), never as values, matching the rule the local
  telemetry has always followed
- The account id is the Supabase UUID, which means nothing outside this project

The handle is sent, because the player chose it and it is already on a public
leaderboard. That is the one identifier a human could recognise, and it is the
one that makes a profile useful to look at.

## Sign-out

`signOut()` calls `resetAnalytics()`, which clears the stored device id and the
identified account. Without it the next person to pick up the phone would be
filed under the account that just left.
