import { describe, expect, it } from 'vitest';
import { Limiter, fingerprint, normalise, parseStack, scrub } from './errors';
import { downgradeCause } from './causes';
import { DIVERGED_NOTE } from '@/features/ranked-rules';
import { NOTE_CLOSED_BEFORE_OPENING, NOTE_PICKS_DROPPED } from '@/state/restore';
import { clsFromShifts, inpFromEvents, rate } from './vitals-math';

describe('an error report carries nothing about a person', () => {
  it('scrubs emails, tokens, account ids and query strings', () => {
    const out = scrub(
      'fetch https://x.supabase.co/rest/v1/game_sessions?select=id&user_id=eq.1 failed for a.b@example.com ' +
        'with eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl as 3f0c1b8e-1d2a-4b5c-9d8e-7f6a5b4c3d2e key phc_abcdefghijklmnop',
    );
    expect(out).not.toMatch(/example\.com|eyJ|3f0c1b8e|phc_abc|user_id/);
    expect(out).toContain('<email>');
    expect(out).toContain('<jwt>');
    expect(out).toContain('<uuid>');
    expect(out).toContain('?<query>');
  });

  it('leaves a bundle path in a stack readable', () => {
    const path = '/_expo/static/js/web/entry-0123456789abcdef0123456789abcdef01234567.js:1:2';
    expect(scrub(path)).toContain('/_expo/static/js/web/entry-');
  });

  it('still catches an opaque token that is not a JWT', () => {
    expect(scrub(`refresh ${'aB3'.repeat(20)} rejected`)).toBe('refresh <token> rejected');
  });

  it('caps what it keeps', () => {
    expect(normalise(new Error('x'.repeat(5000))).message.length).toBeLessThanOrEqual(301);
  });

  it('copes with things that are not errors', () => {
    expect(normalise('boom')).toMatchObject({ type: 'Non-Error string', message: 'boom', stack: '' });
    expect(normalise(undefined).type).toBe('Non-Error undefined');
    expect(normalise(null).type).toBe('Non-Error null');
    expect(normalise({ message: 'shaped', name: 'FunctionsHttpError' }).type).toBe('FunctionsHttpError');
  });
});

describe('stacks', () => {
  it('reads V8 and Hermes frames, outermost first', () => {
    const frames = parseStack(
      'TypeError: x is undefined\n    at inner (https://18-0.co/_expo/static/js/web/entry.js:10:20)\n    at https://18-0.co/a.js:1:2',
    );
    expect(frames).toEqual([
      { function: '?', filename: 'https://18-0.co/a.js', lineno: 1, colno: 2 },
      { function: 'inner', filename: 'https://18-0.co/_expo/static/js/web/entry.js', lineno: 10, colno: 20 },
    ]);
  });

  it('reads JavaScriptCore frames', () => {
    expect(parseStack('inner@https://18-0.co/a.js:3:4\n@https://18-0.co/a.js:5:6')).toEqual([
      { function: '?', filename: 'https://18-0.co/a.js', lineno: 5, colno: 6 },
      { function: 'inner', filename: 'https://18-0.co/a.js', lineno: 3, colno: 4 },
    ]);
  });
});

describe('a loop cannot flood', () => {
  it('groups the same bug whatever number it mentions', () => {
    const a = fingerprint(normalise(new RangeError('index 3 out of range')), 'global');
    const b = fingerprint(normalise(new RangeError('index 4 out of range')), 'global');
    expect(a).toBe(b);
  });

  it('sends the 1st, 10th and 100th of one bug and counts the rest', () => {
    const limiter = new Limiter(1000, 1000);
    const sent: number[] = [];
    for (let i = 0; i < 500; i++) {
      const admitted = limiter.admit('same', i * 1000);
      if (admitted) sent.push(admitted.occurrence);
    }
    expect(sent).toEqual([1, 10, 100]);
  });

  it('holds a burst to the per-minute cap and reports what it held', () => {
    const limiter = new Limiter(5, 25);
    const out = Array.from({ length: 8 }, (_, i) => limiter.admit(`bug-${i}`, 0));
    expect(out.filter(Boolean)).toHaveLength(5);
    const later = limiter.admit('bug-late', 61_000);
    expect(later).toEqual({ occurrence: 1, suppressed: 3 });
  });

  it('stops for the session at the session cap', () => {
    const limiter = new Limiter(1000, 25);
    const sent = Array.from({ length: 40 }, (_, i) => limiter.admit(`bug-${i}`, i)).filter(Boolean);
    expect(sent).toHaveLength(25);
  });
});

describe('web vitals', () => {
  it('takes the worst session window for CLS, not the page total', () => {
    const cls = clsFromShifts([
      { value: 0.05, startTime: 0, hadRecentInput: false },
      { value: 0.05, startTime: 500, hadRecentInput: false },
      // A gap of more than a second starts a new window.
      { value: 0.08, startTime: 3000, hadRecentInput: false },
      { value: 0.5, startTime: 3100, hadRecentInput: true },
    ]);
    expect(cls).toBeCloseTo(0.1);
  });

  it('measures an interaction by its slowest event and skips one in fifty', () => {
    expect(inpFromEvents([])).toBeNull();
    expect(inpFromEvents([
      { interactionId: 1, duration: 40 },
      { interactionId: 1, duration: 120 },
      { interactionId: 2, duration: 80 },
      { interactionId: 0, duration: 900 },
    ])).toBe(120);
    const many = Array.from({ length: 100 }, (_, i) => ({ interactionId: i + 1, duration: i === 0 ? 2000 : i === 1 ? 1500 : 50 }));
    expect(inpFromEvents(many)).toBe(50);
  });

  it('rates against the published thresholds', () => {
    expect(rate('lcp', 2500)).toBe('good');
    expect(rate('lcp', 3000)).toBe('needs-improvement');
    expect(rate('inp', 501)).toBe('poor');
  });
});

describe('a downgrade is sent as a cause, never as the sentence', () => {
  // Every sentence the game can hand `downgrade()` today, from ranked.ts,
  // start-game.ts, play.tsx, ranked-rules.ts and state/restore.ts. A new one lands in `other` until it is added.
  const cases: [string, string][] = [
    ['The server did not answer in time.', 'timeout'],
    ['Could not reach the server. This season stayed on this device.', 'offline'],
    ['Ranked play needs a connection.', 'offline'],
    ['Ranked play is not configured.', 'offline'],
    ['Could not start a session.', 'session'],
    ['Could not open a ranked game.', 'session'],
    ['Ranked play could not start.', 'session'],
    ['That gameday has closed.', 'gameday_closed'],
    ['That challenge is no longer open.', 'challenge_closed'],
    ['This app is scoring with model 9 and the server with 10. The server\'s number is the one on the board.', 'version_mismatch'],
    ['The server scored this 93.4, not 93.1.', 'score_disagreement'],
    ['Too many requests. Give it a moment.', 'refused'],
    ['That player was not part of this spin.', 'refused'],
    ['The server could not record that. Nothing was saved.', 'refused'],
    ['The server refused that.', 'refused'],
    // Imported rather than copied, so rewording one of these fails here
    // instead of quietly turning into `other` on the dashboard.
    [DIVERGED_NOTE, 'diverged'],
    [NOTE_CLOSED_BEFORE_OPENING, 'interrupted'],
    [NOTE_PICKS_DROPPED, 'picks_dropped'],
  ];
  for (const [note, cause] of cases) {
    it(`"${note.slice(0, 40)}" is ${cause}`, () => expect(downgradeCause(note)).toBe(cause));
  }
});
