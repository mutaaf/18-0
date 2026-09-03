import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAGS, FLAG_LIST, isValidValue, resolveFlag, type FlagDefinition } from './registry';

/**
 * The mechanism, not the documentation.
 *
 * A flag pattern held together by a wiki page decays into forty flags nobody
 * can explain. Every rule the pattern claims is asserted here, so breaking it
 * fails `pnpm -r test` and CI rather than being discovered a year later by
 * whoever is trying to delete something.
 *
 * Two of these read the source tree rather than the registry, because the most
 * important rules are about where flags are *not*.
 */

/** The repository root. Vitest runs with `apps/mobile` as its directory. */
const ROOT = resolve(process.cwd(), '../..');

/** Every source file under a directory, ignoring what is not ours. */
function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry === 'generated' || entry.startsWith('.')) continue;
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|sql|mjs)$/.test(entry)) out.push(full);
    }
  };
  walk(directory);
  return out;
}

const read = (path: string) => readFileSync(path, 'utf8');

describe('the registry declares enough to remove a flag later', () => {
  it('keys are lower snake_case and match the key they are filed under', () => {
    for (const [filed, definition] of Object.entries(FLAGS)) {
      expect(definition.key, `${filed} is filed under a different key`).toBe(filed);
      expect(definition.key, `${filed} is not lower snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('every flag says what it controls and who decides', () => {
    for (const definition of FLAG_LIST) {
      expect(definition.summary.length, `${definition.key} has no useful summary`).toBeGreaterThan(19);
      expect(definition.owner.length, `${definition.key} has no owner`).toBeGreaterThan(0);
    }
  });

  /**
   * The rule that does the real work.
   *
   * A flag with no expiry is permanent, and permanent flags are how a codebase
   * ends up with two of everything. When this fails the answer is always one
   * of three lines of work: delete the flag, ship the winner, or extend the
   * date on purpose.
   */
  it('no flag has outlived its removeBy date', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const definition of FLAG_LIST) {
      expect(definition.removeBy, `${definition.key} has a malformed removeBy`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
      expect(
        definition.removeBy >= today,
        `${definition.key} was due for removal on ${definition.removeBy}. ` +
          'Delete it, ship the winner, or move the date deliberately.',
      ).toBe(true);
    }
  });

  it('a toggle is a boolean and nothing else', () => {
    for (const definition of FLAG_LIST.filter((f) => f.kind === 'toggle')) {
      expect(typeof definition.fallback, `${definition.key} is a toggle`).toBe('boolean');
      expect(definition.variants, `${definition.key} is a toggle with variants`).toBeUndefined();
      expect(definition.metric, `${definition.key} is a toggle with a metric`).toBeUndefined();
    }
  });

  /**
   * An experiment has to be analysable before it is launched: at least two
   * arms, a `control` to measure against, and one named metric decided in
   * advance rather than chosen afterwards from whatever moved.
   */
  it('an experiment has arms, a control, and a metric', () => {
    for (const definition of FLAG_LIST.filter((f) => f.kind === 'experiment')) {
      const variants = definition.variants ?? [];
      expect(variants.length, `${definition.key} needs at least two arms`).toBeGreaterThan(1);
      expect(variants, `${definition.key} has no control arm`).toContain('control');
      expect(definition.fallback, `${definition.key} must fall back to control`).toBe('control');
      expect(definition.metric, `${definition.key} names no metric`).toBeTruthy();
    }
  });

  /**
   * And the metric has to be an event this app actually sends. A metric naming
   * an event that does not exist is an experiment that can never be read, and
   * nothing else in the system would ever have said so.
   */
  it("every experiment's metric is a real telemetry event", () => {
    const telemetry = read(resolve(ROOT, 'apps/mobile/src/features/telemetry.ts'));
    for (const definition of FLAG_LIST.filter((f) => f.kind === 'experiment')) {
      expect(
        telemetry.includes(`'${definition.metric}'`),
        `${definition.key} measures ${definition.metric}, which is not an EventName`,
      ).toBe(true);
    }
  });

  /** Two is a mechanism. Twenty is a second product with no tests of its own. */
  it('stays short enough to hold in your head', () => {
    expect(
      FLAG_LIST.length,
      'More than a dozen live flags. Retire some before adding another.',
    ).toBeLessThanOrEqual(12);
  });
});

/**
 * THE ONE INVARIANT — a flag may never change what a roster scores.
 *
 * Asserted by reading the source tree, because it is the kind of rule that is
 * broken by someone reasonably solving a different problem. The scoring model
 * and the server are deliberately outside the reach of this system: they change
 * by build and by migration, which is auditable and reproducible. A rating that
 * depended on a remote toggle would make the leaderboard unverifiable and every
 * `score_disagreement` unexplainable.
 */
describe('flags cannot reach a rating', () => {
  const forbidden = ['packages/domain/src', 'packages/data/src', 'supabase'];

  it('no flag key appears in the domain, the dataset or the server', () => {
    for (const directory of forbidden) {
      for (const file of sourceFiles(resolve(ROOT, directory))) {
        const text = read(file);
        for (const definition of FLAG_LIST) {
          // Word-bounded: `gameday` the flag key, not `gameday_key` the column
          // or the word in a sentence about the mode.
          const quoted = new RegExp(`['"\`]${definition.key}['"\`]\\s*[,:)\\]]`);
          const flagShaped = /useFlag\(|\bflag\(|features\/flags/.test(text);
          expect(
            flagShaped && quoted.test(text),
            `${file.replace(ROOT, '')} reads flag "${definition.key}". ` +
              'Scoring and the server must not be flaggable.',
          ).toBe(false);
        }
      }
    }
  });

  it('nothing outside the app imports the flag runtime', () => {
    for (const directory of forbidden) {
      for (const file of sourceFiles(resolve(ROOT, directory))) {
        expect(
          read(file).includes('features/flags'),
          `${file.replace(ROOT, '')} imports the flag runtime`,
        ).toBe(false);
      }
    }
  });
});

/**
 * A flag nobody reads is configuration pretending to be a feature — and it is
 * the exact residue of a half-finished change or a half-removed experiment.
 */
describe('every flag is wired to something', () => {
  const app = sourceFiles(resolve(ROOT, 'apps/mobile'))
    .filter((f) => !f.endsWith('registry.ts') && !f.endsWith('registry.test.ts'))
    .map(read)
    .join('\n');

  it('is read somewhere in the app', () => {
    for (const definition of FLAG_LIST) {
      expect(
        app.includes(`useFlag('${definition.key}')`) || app.includes(`flag('${definition.key}')`),
        `${definition.key} is declared but never read. Wire it up or delete it.`,
      ).toBe(true);
    }
  });
});

describe('resolution is total, ordered, and refuses nonsense', () => {
  const toggle: FlagDefinition = {
    key: 'a_toggle',
    kind: 'toggle',
    summary: 'A toggle used only by this test file.',
    owner: 'test',
    removeBy: '2999-01-01',
    fallback: true,
  };
  const experiment: FlagDefinition = {
    key: 'an_experiment',
    kind: 'experiment',
    summary: 'An experiment used only by this test file.',
    owner: 'test',
    removeBy: '2999-01-01',
    fallback: 'control',
    variants: ['control', 'treatment'],
    metric: 'app_opened',
  };

  it('falls back when nothing else has an opinion', () => {
    expect(resolveFlag(toggle, null, null)).toEqual({ value: true, source: 'fallback' });
    expect(resolveFlag(experiment, {}, {})).toEqual({ value: 'control', source: 'fallback' });
  });

  it('prefers remote over the fallback, and an override over remote', () => {
    expect(resolveFlag(toggle, { a_toggle: false }, null)).toEqual({
      value: false,
      source: 'remote',
    });
    expect(resolveFlag(toggle, { a_toggle: false }, { a_toggle: true })).toEqual({
      value: true,
      source: 'override',
    });
  });

  /**
   * The check that keeps a typo in a web form from blanking a shipped screen.
   * Remote configuration is untrusted input, and the fallback is always a
   * legitimate answer.
   */
  it('discards a value the definition does not allow', () => {
    expect(resolveFlag(toggle, { a_toggle: 'yes' }, null).source).toBe('fallback');
    expect(resolveFlag(experiment, { an_experiment: true }, null).source).toBe('fallback');
    expect(resolveFlag(experiment, { an_experiment: 'tratment' }, null).source).toBe('fallback');
    expect(resolveFlag(experiment, { an_experiment: 'treatment' }, null)).toEqual({
      value: 'treatment',
      source: 'remote',
    });
    // Including from an override, so a stale device-local value cannot outlive
    // the variant it named.
    expect(resolveFlag(experiment, null, { an_experiment: 'gone' }).source).toBe('fallback');
  });

  it('ignores keys it has never heard of', () => {
    expect(resolveFlag(toggle, { something_else: false }, { another: 1 })).toEqual({
      value: true,
      source: 'fallback',
    });
  });

  it('validates by kind', () => {
    expect(isValidValue(toggle, false)).toBe(true);
    expect(isValidValue(toggle, 'false')).toBe(false);
    expect(isValidValue(experiment, 'control')).toBe(true);
    expect(isValidValue(experiment, true)).toBe(false);
  });
});
