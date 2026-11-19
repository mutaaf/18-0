/**
 * Turn a StoreKit 2 purchase into respins (docs/respins.md).
 *
 * The app sends the transaction's JWS exactly as StoreKit handed it over, and
 * finishes the transaction only after this answers. Nothing else the app says
 * is read: the pack, the quantity, the environment and the account it was
 * bought for all come out of the signed payload.
 *
 *   1. The JWS is verified offline against Apple Root CA - G3, which is
 *      embedded (`_shared/respins.ts`, from packages/respins): the chain, both
 *      of Apple's certificate OIDs, and the ES256 signature. No App Store
 *      Server API key is involved, and no network.
 *   2. The payload must be this app, one of the two packs, a consumable, not
 *      refunded, and from an environment this server accepts.
 *   3. `grant_respin_purchase` credits it with reference `apple:<id>`, which is
 *      UNIQUE: re-sending a transaction grants it once.
 *
 * ENVIRONMENTS. Production is always accepted. Sandbox -- which is what App
 * Review and every TestFlight tester buy in, without being charged -- only when
 * IAP_ACCEPT_SANDBOX=true. The owner has to set it before the products go to
 * review, or the reviewer's purchase fails; with it on, a TestFlight tester's
 * free purchase grants real respins, which is why every grant records its
 * environment. Xcode's local StoreKit testing is signed by a certificate Xcode
 * makes, not Apple's, so it needs IAP_ACCEPT_XCODE=true *and* that certificate
 * in IAP_XCODE_ROOT_CERT (base64 DER); never set either in production.
 *
 * Deploy: supabase functions deploy redeem-purchase
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { audit, beginRequest, readJsonObject, corsHeaders, instrument, log, traceHeaders, withinRateLimit } from '../_shared/observability.ts';
import {
  APPLE_ROOT_CA_G3,
  BUNDLE_ID,
  PurchaseRejected,
  acceptTransaction,
  verifySignedTransaction,
  type Environment,
} from '../_shared/respins.ts';

const REDEEMS_PER_MINUTE = 20;

/**
 * Refusals the app should stop retrying, and finish the transaction on.
 *
 * Deliberately short. A transaction left unfinished is re-sent on every launch
 * and costs nothing; one finished on a refusal that turns out to be our bug is
 * a player's money gone. So a signature the verifier did not like, or an
 * environment this server is not configured for, stays unfinished and is tried
 * again after the fix.
 */
const FINAL = new Set(['revoked', 'wrong_app', 'unknown_product', 'already_redeemed']);

Deno.serve(instrument('redeem-purchase', async (req) => {
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

  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: auth } = await asUser.auth.getUser();
  const user = auth?.user;
  if (!user) return json({ error: 'unauthenticated' }, 401);

  let body: { signedTransaction?: unknown };
  try {
    body = await readJsonObject(req);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const refuse = async (reason: string, status: number, detail: Record<string, unknown> = {}) => {
    await audit(admin, ctx, {
      event: 'purchase_redeem_requested',
      outcome: 'rejected',
      actorId: user.id,
      subjectType: 'purchase',
      subjectId: typeof detail.transaction_id === 'string' ? detail.transaction_id : undefined,
      detail: { reason, ...detail },
    });
    return json({ error: reason, final: FINAL.has(reason) }, status);
  };

  if (!await withinRateLimit(admin, ctx, user.id, 'redeem', REDEEMS_PER_MINUTE)) {
    return await refuse('rate_limited', 429);
  }
  if (typeof body.signedTransaction !== 'string') return await refuse('malformed', 400);

  const environments: Environment[] = ['Production'];
  if (Deno.env.get('IAP_ACCEPT_SANDBOX') === 'true') environments.push('Sandbox');
  const roots = [APPLE_ROOT_CA_G3];
  const xcodeRoot = Deno.env.get('IAP_XCODE_ROOT_CERT');
  if (Deno.env.get('IAP_ACCEPT_XCODE') === 'true' && xcodeRoot) {
    environments.push('Xcode', 'LocalTesting');
    roots.push(xcodeRoot.trim());
  }

  let grant;
  try {
    const transaction = await verifySignedTransaction(body.signedTransaction, { roots });
    grant = acceptTransaction(transaction, { bundleId: BUNDLE_ID, environments });
  } catch (error) {
    if (error instanceof PurchaseRejected) {
      log('warn', ctx, { event: 'purchase_rejected', reason: error.message });
      return await refuse(error.reason, 400, { detail: error.message });
    }
    log('error', ctx, { event: 'purchase_verify_failed', reason: (error as Error).message });
    return await refuse('verify_failed', 500);
  }

  // A token that is not a UUID was not set by this app; treat it as absent
  // rather than letting it fail the cast.
  const token = grant.appAccountToken && /^[0-9a-f-]{36}$/.test(grant.appAccountToken) ? grant.appAccountToken : null;

  const { data, error } = await admin.rpc('grant_respin_purchase', {
    p_user: user.id,
    p_transaction_id: grant.transactionId,
    p_product_id: grant.productId,
    p_respins: grant.respins,
    p_environment: grant.environment,
    p_token: token,
  });
  if (error) {
    const reason = error.message;
    if (reason === 'account_mismatch' || reason === 'already_redeemed') {
      return await refuse(reason, 409, { transaction_id: grant.transactionId });
    }
    log('error', ctx, { event: 'purchase_grant_failed', reason });
    return await refuse('grant_failed', 500, { transaction_id: grant.transactionId });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { granted: boolean; balance: number } | undefined;

  // The grant is committed; the trail is the second record of it, not the
  // first, so a missing audit row is logged rather than undone.
  const recorded = await audit(admin, ctx, {
    event: 'purchase_redeemed',
    outcome: 'ok',
    actorId: user.id,
    subjectType: 'purchase',
    subjectId: grant.transactionId,
    detail: {
      product_id: grant.productId,
      respins: grant.respins,
      environment: grant.environment,
      granted: row?.granted === true,
    },
  });
  if (!recorded) log('error', ctx, { event: 'purchase_audit_missing', transaction: grant.transactionId });

  return json({
    granted: row?.granted === true,
    respins: grant.respins,
    balance: Number(row?.balance ?? 0),
    transactionId: grant.transactionId,
  });
}));
