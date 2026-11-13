#!/usr/bin/env node
/**
 * Hand an uploaded build to the public TestFlight group.
 *
 *   node scripts/store/beta-release.mjs --build 14 --notes-file notes.txt
 *   node scripts/store/beta-release.mjs            # newest build, notes from git
 *
 * `eas submit` ends when Apple has the binary, not when testers can install it.
 * Between the two, Apple processes the build (minutes, sometimes most of an
 * hour), and a build that is not VALID yet cannot be added to a group: the API
 * answers 404 for the build rather than saying "not processed", which is what
 * made the first run of this look like a wrong id. So this polls until the
 * build is VALID, then:
 *
 *   1. answers export compliance (the app uses only exempt, OS-provided
 *      encryption) -- without this the build sits at "Missing Compliance" and
 *      no tester ever sees it;
 *   2. writes What to Test;
 *   3. adds it to the public group "Beta" (link Q79YnwEs);
 *   4. submits it for Beta App Review, which an external group needs. Apple
 *      answers "already submitted" or "not needed" for builds after the first
 *      approved one in a version; both are fine.
 *
 * It never touches the App Store version, the listing or App Review. TestFlight
 * only -- submitting for the store stays a human decision.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { asc, ascAll, patch, post } from './asc-client.mjs';

const APP = '6808414695';
const GROUP = 'a8d59496-cba0-48bf-96e2-2a70666e45c8'; // "Beta", public link Q79YnwEs
const WAIT_MS = 75 * 60_000;
const POLL_MS = 30_000;

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const buildNumber = arg('--build');
const since = arg('--since');
let notes = arg('--notes-file') ? readFileSync(arg('--notes-file'), 'utf8').trim() : undefined;

/**
 * What to Test from the merged pull requests since the last beta. Squash merges
 * make each subject a PR title, which is already written for a reader; the
 * "(#47)" is noise to a tester.
 */
function notesFromGit(from) {
  const range = from ? [`${from}..HEAD`] : ['-15'];
  const subjects = execFileSync('git', ['log', '--format=%s', '--no-merges', ...range, '--', 'apps/mobile', 'packages',
    // Store copy and the website's static files are not in the build testers install.
    ':(exclude)apps/mobile/store', ':(exclude)apps/mobile/public'], {
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.replace(/\s*\(#\d+\)$/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
  if (subjects.length === 0) return 'Fixes and polish.';
  return [
    'New since the last beta:',
    '',
    ...subjects.map((s) => `- ${s}`),
    '',
    'Tell us if anything stutters, lands in the fold, or gets cut off.',
  ].join('\n');
}

notes ??= notesFromGit(since);
// Apple's limit on What to Test.
if (notes.length > 4000) notes = `${notes.slice(0, 3990)}\n…`;

async function findBuild() {
  const filter = buildNumber ? `&filter[version]=${encodeURIComponent(buildNumber)}` : '';
  // One page on purpose: ascAll follows `next` links, so limit=1 would still walk every build.
  const { data } = await asc(`/v1/builds?filter[app]=${APP}${filter}&sort=-uploadedDate&limit=1`);
  return data[0];
}

const deadline = Date.now() + WAIT_MS;
let build;
for (;;) {
  build = await findBuild();
  const state = build?.attributes.processingState;
  console.log(`build ${build?.attributes.version ?? buildNumber ?? '?'}: ${state ?? 'not visible yet'}`);
  if (state === 'VALID') break;
  if (state === 'FAILED' || state === 'INVALID') throw new Error(`Apple rejected build processing: ${state}`);
  if (Date.now() > deadline) throw new Error('build never became VALID; re-run this once App Store Connect shows it');
  await new Promise((r) => setTimeout(r, POLL_MS));
}

if (build.attributes.usesNonExemptEncryption == null) {
  await patch(`/v1/builds/${build.id}`, 'builds', build.id, { usesNonExemptEncryption: false });
  console.log('export compliance: exempt');
}

const locs = await ascAll(`/v1/builds/${build.id}/betaBuildLocalizations`);
const en = locs.find((l) => l.attributes.locale === 'en-US');
if (en) await patch(`/v1/betaBuildLocalizations/${en.id}`, 'betaBuildLocalizations', en.id, { whatsNew: notes });
else
  await post('/v1/betaBuildLocalizations', {
    type: 'betaBuildLocalizations',
    attributes: { locale: 'en-US', whatsNew: notes },
    relationships: { build: { data: { type: 'builds', id: build.id } } },
  });
console.log('what to test:\n' + notes.replace(/^/gm, '  '));

// Adding a build to a group can 404 for a few minutes after it turns VALID.
for (let attempt = 1; ; attempt++) {
  try {
    await asc(`/v1/betaGroups/${GROUP}/relationships/builds`, {
      method: 'POST',
      body: JSON.stringify({ data: [{ type: 'builds', id: build.id }] }),
    });
    console.log('added to the public group');
    break;
  } catch (e) {
    if (attempt >= 20) throw e;
    console.log(`group add not accepted yet (${String(e.message ?? e).slice(0, 120)}); retrying`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

try {
  await post('/v1/betaAppReviewSubmissions', {
    type: 'betaAppReviewSubmissions',
    relationships: { build: { data: { type: 'builds', id: build.id } } },
  });
  console.log('submitted for Beta App Review');
} catch (e) {
  console.log('beta review:', String(e.message ?? e).slice(0, 300));
}

const detail = await asc(`/v1/builds/${build.id}/buildBetaDetail`);
console.log('external state:', detail.data.attributes.externalBuildState);
