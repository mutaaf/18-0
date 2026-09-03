/**
 * Delete the calling account and everything attached to it.
 *
 * Apple requires any app that lets you create an account to let you delete it
 * from inside the app (App Store Review Guideline 5.1.1(v)), and an anonymous
 * identity is still an account. This exists from the first day accounts do,
 * rather than being retrofitted when review asks for it.
 *
 * Deleting the auth user cascades: profile, sessions, spins, selections and
 * challenges all reference `auth.users(id) on delete cascade`. The audit trail
 * is not attached to that cascade at all — it cannot be, because it is
 * append-only and a cascade would have to rewrite it. The record that a game
 * was played and scored therefore survives, holding an actor id that no longer
 * resolves to an account.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { audit, beginRequest, corsHeaders, log, traceHeaders } from '../_shared/observability.ts';


Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const ctx = beginRequest(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...CORS, ...traceHeaders(ctx) },
    });

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthenticated' }, 401);

  const asUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: auth } = await asUser.auth.getUser();
  const user = auth?.user;
  if (!user) return json({ error: 'unauthenticated' }, 401);

  // What was about to be removed, counted before it goes, so the trail can say
  // how much was deleted without keeping any of it.
  const [{ count: sessions }, { data: profile }] = await Promise.all([
    admin.from('game_sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    admin.from('profiles').select('handle').eq('id', user.id).maybeSingle(),
  ]);

  // The deletion event itself is recorded against a one-way digest rather than
  // the raw id, so the tombstone does not re-state the identity being removed.
  const subject = await sha256(user.id);

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    log('error', ctx, { event: 'account_delete_failed', reason: error.message });
    await audit(admin, ctx, {
      event: 'account_deleted',
      outcome: 'error',
      subjectType: 'account_digest',
      subjectId: subject,
      detail: { reason: error.message },
    });
    return json({ error: 'delete_failed' }, 500);
  }

  // The analytics processor holds a copy of the gameplay events under this
  // same id, and the privacy policy says deleting the account deletes those
  // too. A promise in a policy that the code does not keep is the worst kind
  // of bug, so it is kept here, in the same request.
  const analytics = await forgetInAnalytics(user.id);

  await audit(admin, ctx, {
    event: 'account_deleted',
    outcome: 'ok',
    subjectType: 'account_digest',
    subjectId: subject,
    detail: {
      sessions_removed: sessions ?? 0,
      had_handle: Boolean(profile?.handle),
      analytics_deleted: analytics,
    },
  });

  return json({ ok: true, sessionsRemoved: sessions ?? 0 });
});

/**
 * Asks PostHog to delete everything held under this account id.
 *
 * `bulk_delete` takes the distinct ids we actually send, which after sign-in
 * is the Supabase user id -- the client aliases the device id onto it at
 * identify time, so deleting this one takes the anonymous history with it.
 *
 * Returns what happened rather than throwing. An analytics processor being
 * unreachable must not fail an account deletion: the account is already gone
 * by the time this runs, and refusing the request would leave the player
 * believing it had not worked. The outcome goes on the audit trail instead,
 * where a failure can be seen and retried.
 *
 * `not_configured` is the honest answer when no key is set, which is the state
 * the repository ships in.
 */
async function forgetInAnalytics(userId: string): Promise<string> {
  const key = Deno.env.get('POSTHOG_PERSONAL_API_KEY');
  const project = Deno.env.get('POSTHOG_PROJECT_ID');
  const host = (Deno.env.get('POSTHOG_HOST') ?? 'https://us.posthog.com').replace(/\/+$/, '');
  if (!key || !project) return 'not_configured';

  try {
    const response = await fetch(`${host}/api/projects/${project}/persons/bulk_delete/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ distinct_ids: [userId] }),
    });
    return response.ok ? 'ok' : `http_${response.status}`;
  } catch (problem) {
    return `failed:${problem instanceof Error ? problem.message : 'unknown'}`;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
