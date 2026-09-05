import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Edge Function scores with a *copy* of this package.
 *
 * Invariant 1 says the client preview and the server run the exact same
 * bundle, and `build:edge` is what makes that true -- it esbuilds `src/index.ts`
 * into `supabase/functions/_shared/domain.ts`, which is what the deployed
 * functions import. Nothing regenerates it automatically. So a change to the
 * scoring model that is not followed by `build:edge` leaves the server on the
 * old model while the client moves to the new one, and the only symptom is
 * that a preview stops agreeing with the result it gets back.
 *
 * That is the same shape as the bug this project already shipped once, where
 * `build.ts` restated the model version instead of deriving it and every card
 * was labelled by a model that had not scored it. A generated file with no
 * check is a generated file that is already stale somewhere.
 *
 * The command is read out of package.json rather than restated here, so this
 * test cannot drift from the build it is checking.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const DOMAIN = resolve(HERE, '..');
const ROOT = resolve(DOMAIN, '../..');
const COMMITTED = join(ROOT, 'supabase/functions/_shared/domain.ts');

describe('the edge bundle is the domain, not a copy of it that drifted', () => {
  it('matches what build:edge produces from the current source', () => {
    const script: string = JSON.parse(
      readFileSync(join(DOMAIN, 'package.json'), 'utf8'),
    ).scripts['build:edge'];

    // Swap the destination rather than appending one, so every other flag --
    // format, platform, target, banner -- is exactly the shipped build's.
    const out = join(mkdtempSync(join(tmpdir(), 'edge-bundle-')), 'domain.ts');
    const command = script.replace(/--outfile=\S+/, `--outfile=${out}`);
    expect(command).not.toBe(script);

    execSync(command, {
      cwd: DOMAIN,
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: `${join(ROOT, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
      },
    });

    if (readFileSync(out, 'utf8') !== readFileSync(COMMITTED, 'utf8')) {
      throw new Error(
        'supabase/functions/_shared/domain.ts is out of date with packages/domain.\n' +
          'The server would score with a different model than the client. Regenerate it:\n' +
          '  pnpm --filter @18-0/domain build:edge',
      );
    }
  });
});
