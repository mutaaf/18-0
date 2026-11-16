/**
 * Request context, structured logs, the audit trail, and rate limiting.
 *
 * The three game endpoints each make decisions that a player has a stake in —
 * which franchise-era they were dealt, whether a pick was allowed, what their
 * roster scored. Those decisions were previously invisible the moment the
 * response was sent. Everything here exists so that afterwards you can answer
 * "what happened, to whom, and when" from a record nobody can edit.
 *
 * Logs go to stdout as single-line JSON, which is what Supabase's log explorer
 * and every log shipper expect. The audit trail goes to `audit_events`, which
 * is append-only at the database level (see 0002).
 */

// deno-lint-ignore no-explicit-any
type Admin = any;

export type Outcome = 'ok' | 'rejected' | 'error';

export interface RequestContext {
  readonly requestId: string;
  readonly client: string;
  /** Milliseconds since the request began. */
  elapsed(): number;
}

/**
 * Start a request.
 *
 * An inbound `x-request-id` is honoured so a trace can span the client and the
 * server, but it is never trusted as a unique key — a caller can send the same
 * one twice, and the audit table treats it as a grouping label, not an identity.
 */
export function beginRequest(req: Request): RequestContext {
  const supplied = req.headers.get('x-request-id');
  const requestId = supplied && UUID.test(supplied) ? supplied : crypto.randomUUID();
  const client = (req.headers.get('x-client') ?? 'unknown').slice(0, 32);
  const startedAt = performance.now();
  return {
    requestId,
    client,
    elapsed: () => Math.round(performance.now() - startedAt),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One line of JSON per event. Never include a token, a header, or a handle. */
export function log(
  level: 'info' | 'warn' | 'error',
  ctx: RequestContext,
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    level,
    ts: new Date().toISOString(),
    request_id: ctx.requestId,
    client: ctx.client,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export interface AuditEntry {
  readonly event: string;
  readonly outcome: Outcome;
  readonly actorId?: string | null;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly detail?: Record<string, unknown>;
}

/**
 * Write one row of the audit trail.
 *
 * Returns false when the row could not be written. Callers that are about to
 * change state should treat that as fatal and refuse — an action nobody can
 * account for afterwards is worse than an action that did not happen. Callers
 * merely noting a rejection can carry on; the request was refused either way.
 */
export async function audit(
  admin: Admin,
  ctx: RequestContext,
  entry: AuditEntry,
): Promise<boolean> {
  const row = {
    request_id: ctx.requestId,
    actor_id: entry.actorId ?? null,
    event: entry.event,
    outcome: entry.outcome,
    subject_type: entry.subjectType ?? null,
    subject_id: entry.subjectId ?? null,
    detail: entry.detail ?? {},
    latency_ms: ctx.elapsed(),
    client: ctx.client,
  };

  const { error } = await admin.from('audit_events').insert(row);
  if (error) {
    log('error', ctx, { event: 'audit_write_failed', target: entry.event, reason: error.message });
    return false;
  }
  log(entry.outcome === 'ok' ? 'info' : 'warn', ctx, {
    event: entry.event,
    outcome: entry.outcome,
    actor_id: entry.actorId ?? null,
    subject_id: entry.subjectId ?? null,
    latency_ms: row.latency_ms,
    ...(entry.detail ?? {}),
  });
  return true;
}

/**
 * Fixed-window rate limit. `true` means the caller may proceed.
 *
 * Fails **closed**: if the counter cannot be consulted we refuse rather than
 * wave everyone through, because the moment this breaks is exactly the moment
 * something is hammering it.
 */
export async function withinRateLimit(
  admin: Admin,
  ctx: RequestContext,
  actorId: string,
  bucket: string,
  limit: number,
  windowSeconds = 60,
): Promise<boolean> {
  const { data, error } = await admin.rpc('consume_rate_limit', {
    p_actor: actorId,
    p_bucket: bucket,
    p_limit: limit,
    p_window: `${windowSeconds} seconds`,
  });
  if (error) {
    log('error', ctx, { event: 'rate_limit_unavailable', bucket, reason: error.message });
    return false;
  }
  return data === true;
}

/** Response headers that let a client correlate its own logs with the server's. */
export function traceHeaders(ctx: RequestContext): Record<string, string> {
  return { 'x-request-id': ctx.requestId };
}

/**
 * CORS for a specific caller, from an allow-list.
 *
 * `ALLOWED_ORIGIN` was previously read as one value and defaulted to `*`, which
 * on the hosted project meant every origin on the internet could call these
 * endpoints from a browser. Pinning it to one origin fixed that and immediately
 * broke local development, because the web build runs on localhost.
 *
 * So it is a comma-separated list, and the matching origin is echoed back —
 * which is what a browser requires, since it compares the header against its
 * own origin rather than accepting a list. `Vary: Origin` keeps a shared cache
 * from serving one caller's header to another.
 */
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGIN') ?? '*')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowAny = ALLOWED_ORIGINS.includes('*');
  const permitted = allowAny || ALLOWED_ORIGINS.includes(origin);
  return {
    'access-control-allow-origin': allowAny ? '*' : permitted ? origin : ALLOWED_ORIGINS[0]!,
    vary: 'Origin',
    'access-control-allow-headers':
      'authorization, apikey, content-type, x-client-info, x-request-id, x-client',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
}

/**
 * One summary line per request, and a JSON 500 instead of a dead connection.
 *
 * The functions already log their *decisions* (`audit`), but a request that
 * never reached a decision -- refused at validation, or thrown out of the
 * handler by a bug -- left nothing at all: an uncaught exception in
 * `Deno.serve` is a bare 500 with no request id, no function name and no line
 * in the logs that says which of the functions it was. Wrapping each handler
 * here gives every request exactly one `request_finished` line, whatever
 * happened inside:
 *
 *   {"event":"request_finished","function":"spin","status":200,"outcome":"ok",
 *    "duration_ms":143,"request_id":"…","client":"ios"}
 *
 * and a `request_crashed` line with the error's class when the handler throws.
 * Never the body, the headers or the caller -- the audit row already ties a
 * request id to an account where that is warranted, and logs are read by more
 * people than the audit table is.
 *
 * Search the function logs for `request_crashed`, or for `"outcome":"error"`,
 * to find every server failure; docs/observability.md has the queries.
 */
export function instrument(
  fn: string,
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    // A preflight is the browser's business, not a request worth a line.
    if (req.method === 'OPTIONS') return await handler(req);
    const startedAt = performance.now();
    const supplied = req.headers.get('x-request-id');
    const client = (req.headers.get('x-client') ?? 'unknown').slice(0, 32);
    const line = (level: 'info' | 'warn' | 'error', fields: Record<string, unknown>) => {
      const text = JSON.stringify({
        level,
        ts: new Date().toISOString(),
        function: fn,
        client,
        duration_ms: Math.round(performance.now() - startedAt),
        ...fields,
      });
      if (level === 'error') console.error(text);
      else if (level === 'warn') console.warn(text);
      else console.log(text);
    };

    try {
      const response = await handler(req);
      const status = response.status;
      const outcome = status < 400 ? 'ok' : status < 500 ? 'rejected' : 'error';
      // The refusal code is the one thing worth reading out of a body, and
      // only a failure has one. Read from a clone so the caller still gets it.
      let code: string | undefined;
      if (status >= 400) {
        try {
          const body = await response.clone().json();
          if (typeof body?.error === 'string') code = body.error.slice(0, 64);
        } catch {
          // Not JSON. The status says enough.
        }
      }
      line(outcome === 'error' ? 'error' : outcome === 'rejected' ? 'warn' : 'info', {
        event: 'request_finished',
        request_id: response.headers.get('x-request-id') ?? supplied ?? null,
        status,
        outcome,
        ...(code ? { code } : {}),
      });
      return response;
    } catch (thrown) {
      const requestId = supplied && UUID.test(supplied) ? supplied : crypto.randomUUID();
      line('error', {
        event: 'request_crashed',
        request_id: requestId,
        status: 500,
        outcome: 'error',
        error_class: thrown instanceof Error ? thrown.name : typeof thrown,
        // Capped. Server messages are ours and Postgres's rather than a
        // player's, and the cap is so one enormous message cannot swamp a line.
        error: (thrown instanceof Error ? thrown.message : String(thrown)).slice(0, 200),
      });
      return new Response(JSON.stringify({ error: 'internal', requestId }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'x-request-id': requestId, ...corsHeaders(req) },
      });
    }
  };
}
