/**
 * Is the server able to play a game right now? Read-only, unauthenticated, cheap.
 *
 * The synthetic monitor (`.github/workflows/monitor.yml`) calls this every
 * fifteen minutes. It must never play a game to find out: a monitor that opens
 * ranked sessions against production is a second harness writing to the real
 * database, and CLAUDE.md records what that looked like the last time -- a
 * regression that was not one, chased as one. So this answers the question
 * from the parts a game depends on, without being a game:
 *
 * - **The Edge runtime boots and runs our code.** It answered.
 * - **The scoring bundle loads.** `domain.ts` is imported and its version
 *   reported, so a deploy that shipped a stale or broken bundle shows up as a
 *   version nobody expected rather than as the first completion that fails.
 * - **The database answers, through the service role, in time.** A count of
 *   playable cards: one indexed read, no rows returned, and a number that is
 *   itself a check -- zero cards means the seed is gone and every spin would
 *   dead-end.
 *
 * 200 with `ok: true`, or 503 with `ok: false` and which check failed. No
 * caller, no account, no row content; nothing here is worth rate limiting
 * beyond what the platform already does.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { DEFAULT_SCORING_CONFIG, RATING_MODEL_VERSION } from '../_shared/domain.ts';
import { corsHeaders, instrument } from '../_shared/observability.ts';

/** Over this the database is up but slow enough that a spin would feel it. */
const DB_SLOW_MS = 1500;

Deno.serve(instrument('health', async (req) => {
  const CORS = { ...corsHeaders(req), 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const checks: Record<string, unknown> = {
    scoring: { ok: true, version: DEFAULT_SCORING_CONFIG.version, ratings: RATING_MODEL_VERSION },
  };

  const started = performance.now();
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { count, error } = await admin
      .from('season_cards')
      .select('id', { count: 'exact', head: true })
      .is('retired_at', null);
    const ms = Math.round(performance.now() - started);
    checks.database = error
      ? { ok: false, ms, error: error.code ?? 'query_failed' }
      : { ok: (count ?? 0) > 0, ms, slow: ms > DB_SLOW_MS, cards: count ?? 0 };
  } catch (thrown) {
    checks.database = {
      ok: false,
      ms: Math.round(performance.now() - started),
      error: thrown instanceof Error ? thrown.name : 'unreachable',
    };
  }

  const ok = Object.values(checks).every((c) => (c as { ok: boolean }).ok);
  return new Response(JSON.stringify({ ok, checks, at: new Date().toISOString() }), {
    status: ok ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  });
}));
