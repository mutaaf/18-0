import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENDINGS } from '@17-0/domain';
import { ratingBucket } from '@/features/telemetry';
import * as Q from '@/features/boxoffice-queue';

/**
 * The iPhone app's Box Office events (boxoffice-queue.ts): numbers, flags and
 * enums only, a capped queue, one random id that the switch deletes, and the
 * batch shape the relay admits.
 */

let n = 0;
const id = () => `id-${++n}`;

describe('vocabulary', () => {
  it('drops an unknown event whole', () => {
    expect(Q.clean('player_selected', { cardId: 'x' })).toBeNull();
    expect(Q.add(Q.emptyQueue(), 'signed_in', {}, 1, true, id).events).toEqual([]);
  });

  it('keeps only known props inside their rules', () => {
    expect(
      Q.clean('game_over', {
        wins: 17,
        losses: 0,
        mode: 'rookie',
        ending: 'PERFECT',
        rating_band: '98+',
        handle: 'someone',
        roster: 'a,b,c',
      }),
    ).toEqual({ wins: 17, losses: 0, mode: 'rookie', ending: 'PERFECT', rating_band: '98+' });
    expect(Q.clean('game_over', { wins: 19, losses: -1, mode: 'fantasy', ending: 'free text', rating_band: 97 })).toEqual({});
    expect(Q.clean('game_over', { wins: Number.NaN, losses: '3' })).toEqual({});
    expect(Q.clean('game_start', { mode: 'scout', ranked: 'yes' })).toEqual({ mode: 'scout' });
    expect(Q.clean('session_start', { returning: true, days_since_last: 4000 })).toEqual({ returning: true });
  });

  it('knows every ending and every rating band the game can produce', () => {
    for (const e of ENDINGS) expect(Q.ENDING_KEYS).toContain(e.key);
    for (const r of [99, 97, 94, 91, 88, 82, 75, 50]) expect(Q.RATING_BANDS).toContain(ratingBucket(r));
  });

  it('translates the telemetry stream the way the web does', () => {
    const over = Q.translate({
      name: 'roster_completed',
      props: { rating: '93-96', record: '14-3', ending: 'ELITE', mode: 'player_iq', assisted: false },
    })!;
    expect(Q.clean(over.name, over.props)).toEqual({ wins: 14, losses: 3, mode: 'player_iq', ending: 'ELITE', rating_band: '93-96' });
    const start = Q.translate({ name: 'play_started', props: { mode: 'gameday', ranked: true, replacing: false } })!;
    expect(Q.clean(start.name, start.props)).toEqual({ mode: 'gameday', ranked: true });
    expect(Q.translate({ name: 'signed_in', props: {} })).toBeNull();
  });
});

describe('queue', () => {
  it('keeps nothing when off, and makes the id with the first event kept', () => {
    expect(Q.add(Q.emptyQueue(), 'game_start', { mode: 'rookie' }, 1, false, id)).toEqual(Q.emptyQueue());
    const q = Q.add(Q.emptyQueue(), 'game_start', { mode: 'rookie' }, 1, true, id);
    expect(q.installId).toMatch(/^id-/);
    expect(Q.add(q, 'game_start', {}, 2, true, id).installId).toBe(q.installId);
  });

  it('is capped, oldest first, on add and on read', () => {
    let q = Q.emptyQueue();
    for (let i = 0; i < Q.QUEUE_CAP + 25; i++) q = Q.add(q, 'game_start', {}, i, true, id);
    expect(q.events).toHaveLength(Q.QUEUE_CAP);
    expect(q.events[0]!.at).toBe(25);
    const big = JSON.stringify({ ...q, events: [...q.events, ...q.events] });
    expect(Q.decode(big).events).toHaveLength(Q.QUEUE_CAP);
  });

  it('survives garbage on disk', () => {
    expect(Q.decode(null)).toEqual(Q.emptyQueue());
    expect(Q.decode('{not json')).toEqual(Q.emptyQueue());
    expect(Q.decode('{"events":[1,{"name":"x"}],"installId":5}')).toEqual(Q.emptyQueue());
  });

  it('sends at most BATCH_MAX, and keeps what arrived while a batch was in flight', () => {
    let q = Q.emptyQueue();
    for (let i = 0; i < 60; i++) q = Q.add(q, 'game_start', {}, i, true, id);
    const batch = Q.next(q, true);
    expect(batch).toHaveLength(Q.BATCH_MAX);
    expect(Q.next(q, false)).toEqual([]);
    q = Q.add(q, 'game_over', { wins: 3 }, 99, true, id);
    q = Q.sent(q, batch);
    expect(q.events.map((e) => e.at)).toEqual([...Array.from({ length: 10 }, (_, i) => 50 + i), 99]);
  });

  it('the switch going off deletes the events and the id', () => {
    let q = Q.add(Q.emptyQueue(), 'game_start', {}, 1, true, id);
    q = Q.clear(q);
    expect(q.events).toEqual([]);
    expect(q.installId).toBeNull();
    expect(Q.next(q, true)).toEqual([]);
  });

  it('counts sessions locally and reports only returning and days', () => {
    const day0 = Date.UTC(2026, 10, 16);
    const first = Q.startSession(Q.emptyQueue(), day0);
    expect(first.props).toEqual({ returning: false, days_since_last: 0 });
    const later = Q.startSession(first.queue, day0 + 3 * 86_400_000);
    expect(later.props).toEqual({ returning: true, days_since_last: 3 });
    expect(later.queue.sessions).toBe(2);
  });
});

describe('the batch', () => {
  it("is PostHog's /batch/ shape with the shared props, no location", () => {
    const q = Q.add(Q.emptyQueue(), 'game_over', { wins: 17, losses: 0 }, Date.UTC(2026, 10, 16), true, () => 'install');
    const body = JSON.parse(Q.body(q.events, 'install', '1.1.0', 'ios'));
    expect(body.api_key).toBe(Q.TOKEN);
    expect(body.batch).toEqual([
      {
        event: 'game_over',
        timestamp: '2026-11-16T00:00:00.000Z',
        properties: {
          app: '17-0',
          surface: 'app',
          platform: 'ios',
          audience: 'general',
          site: '18-0.co',
          release: '1.1.0',
          wins: 17,
          losses: 0,
          distinct_id: 'install',
          $lib: '17-0-native',
          $geoip_disable: true,
        },
      },
    ]);
  });

  it("goes to the relay with Cast List's page for 17-0 as the Referer", () => {
    expect(Q.ENDPOINT).toBe('https://mutaafaziz.com/boxoffice/e/batch/');
    expect(Q.REFERER).toBe('https://18-0.co/');
    const sender = readFileSync(join(process.cwd(), 'src/features/boxoffice.ios.ts'), 'utf8');
    expect(sender).toMatch(/Referer: Q\.REFERER/);
  });

  it('Android and the tests get the no-op; no SDK, no advertising id anywhere in the sender', () => {
    const noop = readFileSync(join(process.cwd(), 'src/features/boxoffice.ts'), 'utf8');
    expect(noop).not.toMatch(/fetch\(/);
    const sender = readFileSync(join(process.cwd(), 'src/features/boxoffice.ios.ts'), 'utf8');
    expect(sender).not.toMatch(/posthog-react-native|AdSupport|advertisingIdentifier|TrackingTransparency/);
  });
});
