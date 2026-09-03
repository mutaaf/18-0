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

## Turning it on

```bash
# apps/mobile/.env  — and as repo secrets for the Pages build
EXPO_PUBLIC_POSTHOG_KEY=phc_...
EXPO_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com   # or us., default is us.
```

**With no key set, no sink is installed and no request is ever made.** That is
the state this repository ships in, and it is why turning this on is a
deliberate act rather than a side effect of deploying.

Prefer the EU host if there is any chance of EU players — it keeps the data in
the EU and makes the GDPR position much simpler.

## What must change before the key goes in

Adding the key sends player data to a third party. Three things have to happen
first, and none of them are code:

1. **`digitalcraftai.com/privacy` has to say so.** It currently states,
   accurately, that the game carries no analytics. Name PostHog as a processor,
   say what is collected (gameplay events, a device-generated id, a chosen
   handle, coarse rating bands), why (product improvement), where it is stored
   (US or EU, per the host above), and how to ask for deletion.
2. **App Store privacy disclosures.** The nutrition label needs *Usage Data →
   Analytics* and *Identifiers → Analytics*, linked to the user. This is
   first-party analytics and not cross-app tracking, so it does not by itself
   require an ATT prompt — but do not add any advertising SDK alongside it
   without revisiting that, because combining the two does.
3. **Google Play Data safety form.** Same declaration, separate form.

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
