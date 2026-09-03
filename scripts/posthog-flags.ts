/**
 * Push the flag registry into PostHog.
 *
 *   npx tsx scripts/posthog-flags.ts                 # dry run: prints the payloads
 *   npx tsx scripts/posthog-flags.ts --apply         # creates or updates them
 *
 * Needs a **personal** API key with `feature_flag:write`, which is a different
 * credential from the one in the app: `EXPO_PUBLIC_POSTHOG_KEY` is a project
 * ingestion token, deliberately write-only for events, and it cannot manage
 * anything. Create one under Settings -> Personal API keys and put it in
 * `.local/posthog.env`, which is gitignored:
 *
 *   POSTHOG_PERSONAL_API_KEY=phx_...
 *   # optional; resolved automatically when the key sees exactly one project
 *   POSTHOG_PROJECT_ID=12345
 *
 * Then:  set -a; . .local/posthog.env; set +a; npx tsx scripts/posthog-flags.ts --apply
 *
 * ---------------------------------------------------------------------------
 *
 * The point of doing this in a script rather than by hand is that the registry
 * stays the single source of truth. A flag whose variants are typed into a web
 * form drifts from the code the moment somebody renames one, and the drift is
 * silent in the worst way: the client discards a value it does not recognise
 * and quietly serves the fallback, so the experiment looks like it is running
 * and is not. Here the payload is generated from `FLAG_LIST`, so the two agree
 * by construction.
 *
 * Idempotent. Run it again after adding a flag; existing ones are patched, not
 * duplicated. It never deletes: a flag removed from the registry is left in
 * PostHog to be archived by a human, because deleting one that something still
 * reads is not a decision a script should take.
 */
import { FLAG_LIST, type FlagDefinition } from '../apps/mobile/src/features/flags/registry.js';

const HOST = (process.env.POSTHOG_API_HOST ?? 'https://us.posthog.com').replace(/\/+$/, '');
const KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const APPLY = process.argv.includes('--apply');

interface Variant {
  key: string;
  name: string;
  rollout_percentage: number;
}

/**
 * An even split that actually adds to 100.
 *
 * Three arms is 33.33 each, and PostHog requires integers summing to exactly
 * 100, so the remainder goes to the first arm rather than being dropped —
 * which would leave a percentage of users matching no variant at all.
 */
function evenSplit(keys: readonly string[]): Variant[] {
  const share = Math.floor(100 / keys.length);
  const remainder = 100 - share * keys.length;
  return keys.map((key, i) => ({
    key,
    name: key,
    rollout_percentage: share + (i === 0 ? remainder : 0),
  }));
}

/** The registry entry, in the shape PostHog's API wants. */
function payloadFor(definition: FlagDefinition) {
  const groups = [{ properties: [], rollout_percentage: 100 }];
  return {
    key: definition.key,
    // Shown in their UI. The owner and the removal date travel with it, because
    // the person who finds this flag in eight months is not the person who made
    // it and the first two questions are always the same.
    name: `${definition.summary} (owner ${definition.owner}, remove by ${definition.removeBy})`,
    active: true,
    filters:
      definition.kind === 'experiment'
        ? { groups, multivariate: { variants: evenSplit(definition.variants ?? []) } }
        : { groups },
  };
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${HOST}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/** The project this key can see, when there is exactly one and no id was given. */
async function projectId(): Promise<string> {
  const explicit = process.env.POSTHOG_PROJECT_ID;
  if (explicit) return explicit;
  const body = (await api('/api/projects/')) as { results?: { id: number; name: string }[] };
  const projects = body.results ?? [];
  if (projects.length === 1) return String(projects[0]!.id);
  throw new Error(
    `This key sees ${projects.length} projects (${projects.map((p) => `${p.id} ${p.name}`).join(', ')}). ` +
      'Set POSTHOG_PROJECT_ID to the one you mean.',
  );
}

async function main(): Promise<void> {
  console.log(`\n18-0 — POSTHOG FLAGS  (${APPLY ? 'APPLY' : 'dry run'})\n` + '='.repeat(64));

  for (const definition of FLAG_LIST) {
    const payload = payloadFor(definition);
    const arms =
      definition.kind === 'experiment'
        ? (payload.filters as { multivariate: { variants: Variant[] } }).multivariate.variants
            .map((v) => `${v.key} ${v.rollout_percentage}%`)
            .join(', ')
        : 'on for 100%';
    console.log(`\n  ${definition.key}  [${definition.kind}]`);
    console.log(`    ${arms}`);
    console.log(`    fallback if unreachable: ${String(definition.fallback)}`);
    if (definition.metric) console.log(`    experiment goal metric: ${definition.metric}`);
  }

  if (!APPLY) {
    console.log(
      '\n  Dry run. Nothing was sent.' +
        '\n  Re-run with --apply and POSTHOG_PERSONAL_API_KEY set.\n',
    );
    return;
  }
  if (!KEY) throw new Error('POSTHOG_PERSONAL_API_KEY is not set. See the header of this file.');

  const project = await projectId();
  const existing = (await api(`/api/projects/${project}/feature_flags/?limit=200`)) as {
    results?: { id: number; key: string }[];
  };
  const byKey = new Map((existing.results ?? []).map((f) => [f.key, f.id]));

  console.log(`\n  project ${project} · ${byKey.size} flag(s) already there\n`);

  for (const definition of FLAG_LIST) {
    const payload = payloadFor(definition);
    const id = byKey.get(definition.key);
    if (id === undefined) {
      await api(`/api/projects/${project}/feature_flags/`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      console.log(`  created  ${definition.key}`);
    } else {
      // Patched rather than replaced, so a rollout percentage somebody set in
      // the UI on purpose is the one thing this does not stamp back over.
      const { filters, ...rest } = payload;
      const keep = definition.kind === 'experiment' ? { ...rest, filters } : rest;
      await api(`/api/projects/${project}/feature_flags/${id}/`, {
        method: 'PATCH',
        body: JSON.stringify(keep),
      });
      console.log(`  updated  ${definition.key}`);
    }
  }

  const stale = [...byKey.keys()].filter((key) => !FLAG_LIST.some((f) => f.key === key));
  if (stale.length > 0) {
    console.log(`\n  in PostHog but not in the registry: ${stale.join(', ')}`);
    console.log('  Left alone. Archive them by hand once nothing reads them.');
  }

  console.log('\n  Done. The app picks these up on its next launch.\n');
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
