/**
 * One request at a time, in the order they were asked for.
 *
 * A ranked pick is sent behind the screen (play.tsx does not wait for it), and
 * the next spin is sent the moment the player taps. They travel on separate
 * connections, so a quick player's spin could reach the server while their
 * pick was still being written -- and the server, correctly, refused it with
 * `pick_first`: "take a player from the last spin first", to somebody who just
 * had. Putting both on one lane makes the server see them in the order the
 * player made them, which is the only order either side's rules make sense in.
 *
 * A failed request does not jam the lane: the next one runs either way, and
 * the failure is still delivered to whoever asked.
 */
export interface Lane {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export function createLane(): Lane {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      const next = tail.then(work, work);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}
