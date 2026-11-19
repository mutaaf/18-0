/**
 * Try again, but only when trying again is safe and only for a while.
 *
 * Only for calls the server makes idempotent. `complete-game` is: a session
 * already completed answers with the stored result (`replayed: true`) rather
 * than scoring twice, so a completion whose answer was lost on the way back
 * can be asked for again and lands exactly once. `spin` is not -- every call
 * that succeeds deals a new franchise-era -- and must never be wrapped in this.
 *
 * The backoff is fixed rather than random: there are at most a few attempts
 * from one phone, not a fleet stampeding a server, and a fixed schedule is one
 * a test can assert.
 */
export interface RetryOptions<T> {
  /** Delays before the second, third, ... attempt. Its length + 1 is the attempt count. */
  readonly delays: readonly number[];
  /** Whether this outcome is worth another attempt. */
  readonly retryable: (outcome: T) => boolean;
  /** Stop starting new attempts after this long, whatever `delays` says. */
  readonly budgetMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(attempt: (n: number) => Promise<T>, options: RetryOptions<T>): Promise<T> {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const started = now();
  let outcome = await attempt(0);
  for (let i = 0; i < options.delays.length; i++) {
    if (!options.retryable(outcome)) return outcome;
    const delay = options.delays[i]!;
    if (options.budgetMs !== undefined && now() - started + delay >= options.budgetMs) return outcome;
    await sleep(delay);
    outcome = await attempt(i + 1);
  }
  return outcome;
}
