import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recentEvents, track } from '@/features/telemetry';
import { cleanProps, isFlatPrimitive, isPiiKey } from './guard';

/**
 * Every event's properties are flat primitives, and none is named like
 * something about a person.
 *
 * Held twice: at run time, by `track()` dropping what breaks either rule
 * (tested below through the real `track`), and at build time, by reading every
 * call that sends an event and checking each property it names -- so a
 * `phone:` added to a `track()` call fails here, in review, rather than being
 * quietly dropped on players' devices where nobody would notice it was ever
 * written.
 */

describe('cleanProps', () => {
  it('keeps strings, finite numbers and booleans', () => {
    expect(cleanProps({ a: 'x', b: 1, c: false, d: 0 }).props).toEqual({ a: 'x', b: 1, c: false, d: 0 });
  });

  it('drops objects, arrays, null, undefined, NaN and Infinity', () => {
    const { props, dropped } = cleanProps({
      ok: 1,
      obj: { a: 1 },
      arr: [1],
      nil: null,
      undef: undefined,
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      fn: () => 1,
    });
    expect(props).toEqual({ ok: 1 });
    expect(dropped.sort()).toEqual(['arr', 'fn', 'inf', 'nan', 'nil', 'obj', 'undef']);
  });

  it('caps a long string, except the stack errors.ts already capped', () => {
    const long = 'x'.repeat(1000);
    expect((cleanProps({ m: long }).props.m as string).length).toBe(300);
    expect((cleanProps({ $exception_stack_trace_raw: long }).props.$exception_stack_trace_raw as string).length).toBe(1000);
  });

  it('never throws, whatever it is handed', () => {
    expect(() => cleanProps(Object.create(null))).not.toThrow();
    expect(isFlatPrimitive(Symbol('x'))).toBe(false);
    expect(isFlatPrimitive(10n)).toBe(false);
  });
});

describe('isPiiKey', () => {
  const pii = [
    'email', 'user_email', 'phone', 'name', 'first_name', 'lastName', 'full_name', 'address', 'ip',
    'ip_address', 'lat', 'lng', 'latitude', 'location', 'password', 'token', 'auth_token', 'secret',
    'user_id', 'userId', 'distinct_id', 'device_id', 'idfa', 'handle', 'username', 'url', 'query', 'dob',
  ];
  const fine = [
    'route', 'last_route', 'build', 'app_version', 'os_version', 'device_class', 'session_id',
    'crashed_session', 'request_id', 'fn', 'outcome', 'ms', 'hitches', 'mode', 'franchise', 'era',
    'reason', 'status', 'error_class', '$exception_message', '$exception_type', '$feature_flag',
    '$feature_flag_response', 'theme', 'platform', 'cause', 'filled', 'target', 'source', 'model_version',
  ];
  for (const key of pii) it(`refuses ${key}`, () => expect(isPiiKey(key)).toBe(true));
  for (const key of fine) it(`allows ${key}`, () => expect(isPiiKey(key)).toBe(false));
});

describe('track()', () => {
  it('drops what breaks the rules before anything can see it', () => {
    track('ui_jank', {
      route: 'play',
      hitches: 2,
      ...({ email: 'a@b.co', nested: { x: 1 }, nan: Number.NaN } as unknown as Record<string, string>),
    });
    const event = recentEvents(1)[0]!;
    expect(event.name).toBe('ui_jank');
    expect(event.props.route).toBe('play');
    expect(event.props.hitches).toBe(2);
    expect(event.props).not.toHaveProperty('email');
    expect(event.props).not.toHaveProperty('nested');
    expect(event.props).not.toHaveProperty('nan');
    for (const value of Object.values(event.props)) expect(isFlatPrimitive(value)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

const APP = process.cwd();

function files(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
    }
  };
  walk(join(APP, 'src'));
  walk(join(APP, 'app'));
  return out;
}

/** The text of the `{...}` that starts at `open`, by brace counting. */
function literalAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  return '';
}

/** Every property name written into an event: `track('x', {...})`, `reportHealth('x', {...})`, `extra: {...}`, `analytics.ts`'s `base()`. */
function writtenKeys(): { key: string; where: string }[] {
  const found: { key: string; where: string }[] = [];
  const CALL = /\b(?:track|reportHealth)\(\s*'[^']+'\s*,\s*\{|\bextra:\s*\{|\bconst base = \(\)[^{]*\{/g;
  // `key:`, `'key':`, and shorthand `{ key, ... }`.
  const KEY = /(?:^|[{,]\s*)(\$?[A-Za-z_][\w$]*|'[^']+')\s*(?=:|,|\})/g;
  for (const file of files()) {
    const source = readFileSync(file, 'utf8');
    for (const call of source.matchAll(CALL)) {
      const literal = literalAt(source, call.index! + call[0].length - 1);
      for (const m of literal.matchAll(KEY)) {
        found.push({ key: m[1]!.replace(/'/g, ''), where: file.slice(APP.length + 1) });
      }
    }
  }
  return found;
}

describe('every property written into an event', () => {
  const keys = writtenKeys();

  it('finds the calls it is checking', () => {
    const names = new Set(keys.map((k) => k.key));
    for (const expected of ['first_frame_ms', 'hitches', 'session_id', 'crashed_session', 'ready_ms', 'fn']) {
      expect(names.has(expected), `did not find ${expected}; the scan is broken`).toBe(true);
    }
  });

  it('is never named like something about a person', () => {
    const offending = keys.filter((k) => isPiiKey(k.key)).map((k) => `${k.key} in ${k.where}`);
    expect(offending, 'rename it, or do not send it').toEqual([]);
  });
});
