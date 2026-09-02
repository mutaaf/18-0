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
