import { describe, expect, it } from 'vitest';
import { RequestTimeoutError, fetchWithTimeout } from './fetch-timeout';
import { createLane } from './lane';
import { withRetry } from './retry';

/** A fetch that never answers, but does honour its signal like a real one. */
const hanging = (seen: { signal?: AbortSignal | null }) => (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    seen.signal = init?.signal ?? null;
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });

describe('a request that never answers', () => {
  it('is abandoned after the timeout, as a timeout', async () => {
    const seen: { signal?: AbortSignal | null } = {};
    const f = fetchWithTimeout(hanging(seen), 20);
    await expect(f('https://example.test')).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(seen.signal?.aborted).toBe(true);
  });

  it("still obeys the caller's own signal, as the caller's abort", async () => {
    const seen: { signal?: AbortSignal | null } = {};
    const f = fetchWithTimeout(hanging(seen), 10_000);
    const controller = new AbortController();
    const pending = f('https://example.test', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes an answer straight through', async () => {
    const f = fetchWithTimeout(async () => new Response('ok', { status: 201 }), 50);
    expect((await f('https://example.test')).status).toBe(201);
  });
});

describe('retrying an idempotent call', () => {
  const noSleep = async () => {};

  it('tries again only while the outcome is retryable', async () => {
    const answers = ['offline', 'offline', 'ok'];
    let calls = 0;
    const out = await withRetry(async () => answers[calls++]!, {
      delays: [1, 1, 1],
      retryable: (o) => o === 'offline',
      sleep: noSleep,
    });
    expect(out).toBe('ok');
    expect(calls).toBe(3);
  });

  it('stops on a final answer at once', async () => {
    let calls = 0;
    const out = await withRetry(async () => (calls++, 'refused'), { delays: [1, 1], retryable: () => false, sleep: noSleep });
    expect(out).toBe('refused');
    expect(calls).toBe(1);
  });

  it('makes delays.length + 1 attempts at most', async () => {
    let calls = 0;
    await withRetry(async () => (calls++, 'offline'), { delays: [1, 1], retryable: () => true, sleep: noSleep });
    expect(calls).toBe(3);
  });

  it('does not start an attempt the budget cannot hold', async () => {
    let clock = 0;
    let calls = 0;
    await withRetry(
      async () => {
        calls++;
        clock += 4000; // each attempt takes four seconds to fail
        return 'offline';
      },
      { delays: [800, 2000], budgetMs: 9000, retryable: () => true, sleep: async (ms) => void (clock += ms), now: () => clock },
    );
    // 4s, +0.8s wait, 4s = 8.8s; another 2s wait would pass 9s.
    expect(calls).toBe(2);
  });
});

describe('the ranked lane', () => {
  it('runs moves in the order they were asked for, even when the first is slower', async () => {
    const lane = createLane();
    const order: string[] = [];
    const pick = lane.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('pick');
    });
    const spin = lane.run(async () => {
      order.push('spin');
    });
    await Promise.all([pick, spin]);
    expect(order).toEqual(['pick', 'spin']);
  });

  it('is not jammed by a failure, and the failure still reaches its caller', async () => {
    const lane = createLane();
    const failing = lane.run(async () => {
      throw new Error('offline');
    });
    const next = lane.run(async () => 'spun');
    await expect(failing).rejects.toThrow('offline');
    await expect(next).resolves.toBe('spun');
  });
});
