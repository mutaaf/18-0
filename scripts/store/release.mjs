/**
 * Cut a release.
 *
 *   node scripts/store/release.mjs --bump patch
 *   node scripts/store/release.mjs --version 0.2.0
 *   node scripts/store/release.mjs --bump patch --dry-run
 *
 * Bumps the marketing version, writes the release notes, tags, and hands the
 * rest to the Release workflow. Build numbers are not its business — EAS holds
 * those and raises them per platform on every production build.
 *
 * The marketing version is the one thing that cannot be automatic. It is a
 * claim about how much changed, App Store Connect calls it a "version train"
 * and will not let two builds share a train and a number, and Apple shows it to
 * everyone who looks at the listing. So it is a decision, and this asks for it.
 *
 * The notes come from `apps/mobile/store/whats-new.json`, the same entry the
 * app's What's New sheet shows, so the store page and the sheet cannot say
 * different things. With no entry for the new version yet, this drafts the
 * commits since the last tag as a starting point -- a list of commit subjects
 * reads like a list of commit subjects, so write the entry, then run again.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WHATS_NEW, storeText, whatsNewFor } from './whats-new.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = join(ROOT, 'apps/mobile/app.config.js');
const DRAFT = join(ROOT, '.local/release-notes.md');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const say = (ok, text, detail = '') =>
  console.log(`  ${ok ? '✓' : '✗'} ${text}${detail ? `  — ${detail}` : ''}`);

const die = (message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
};

// ---------------------------------------------------------------------------
// The version

const current = /version:\s*'([^']+)'/.exec(readFileSync(CONFIG, 'utf8'))?.[1];
if (!current) die(`Could not find a version in ${CONFIG}`);

function bumped(from, kind) {
  const [major, minor, patch] = from.split('.').map(Number);
  if ([major, minor, patch].some(Number.isNaN)) die(`Version ${from} is not major.minor.patch`);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  die(`--bump takes major, minor or patch, not "${kind}"`);
}

const next = value('version') ?? (value('bump') ? bumped(current, value('bump')) : null);
if (!next) die('Pass --bump <major|minor|patch> or --version <x.y.z>');
if (!/^\d+\.\d+\.\d+$/.test(next)) die(`--version ${next} is not major.minor.patch`);

// ---------------------------------------------------------------------------
// The notes

const lastTag = (() => {
  try {
    return git('describe', '--tags', '--abbrev=0');
  } catch {
    return null; // No tags yet; this is the first release.
  }
})();

function draftNotes() {
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const subjects = git('log', range, '--no-merges', '--format=%s')
    .split('\n')
    .filter(Boolean)
    // Housekeeping is true and dull. The store page is not a changelog.
    .filter((s) => !/^(chore|ci|docs|test|refactor)[(:]/i.test(s))
    // A squashed pull request lands twice — once as "Subject (#12)" on main and
    // once as the branch's own "Subject". Same change, and a draft that lists
    // both reads like the release did everything twice.
    .map((s) => s.replace(/\s*\(#\d+\)$/, ''))
    .filter((s, i, all) => all.indexOf(s) === i);

  return [
    `# ${next}`,
    '',
    '<!-- Draft. Rewrite this as an entry in apps/mobile/store/whats-new.json',
    '     (headline, subhead, 2-4 callouts, notes; see CLAUDE.md), then run again.',
    '     Apple allows 4000 characters and shows the first few lines. -->',
    '',
    ...subjects.map((s) => `- ${s}`),
    '',
  ].join('\n');
}

if (value('notes') !== null || value('notes-file') !== null) {
  die(`--notes and --notes-file are gone: write the ${next} entry in ${WHATS_NEW} instead,\n  so the store and the app's What's New sheet say the same thing.`);
}
const entry = whatsNewFor(next);
const notes = entry ? storeText(entry) : null;

console.log(`\nRELEASE  ${current} → ${next}${lastTag ? `  (since ${lastTag})` : '  (first tag)'}\n`);

if (!notes) {
  mkdirSync(dirname(DRAFT), { recursive: true });
  writeFileSync(DRAFT, draftNotes());
  console.log(`  No ${next} entry in ${WHATS_NEW}.`);
  console.log(`  Drafted the ${lastTag ? `commits since ${lastTag}` : 'whole history'} to start it from:`);
  console.log(`      ${DRAFT}`);
  console.log('\n  Write the entry (pnpm test checks it), then run again with:');
  console.log(`      node scripts/store/release.mjs --version ${next}\n`);
  process.exit(0);
}

// Apple's ceiling. Hitting it at submission time means the release is already
// tagged and built.
if (notes.length > 4000) die(`Release notes are ${notes.length} characters; Apple allows 4000.`);

// ---------------------------------------------------------------------------

console.log('CHECKS');
const dirty = git('status', '--porcelain');
say(!dirty, 'the working tree is clean', dirty ? `${dirty.split('\n').length} file(s) modified` : '');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
say(branch === 'main', 'on main', branch);
const tagExists = git('tag', '--list', `v${next}`);
say(!tagExists, `v${next} is not already a tag`);
if (dirty || branch !== 'main' || tagExists) die('Refusing to cut a release from here.');

console.log('\nNOTES\n');
console.log(notes.split('\n').map((l) => `  │ ${l}`).join('\n'));

if (flag('dry-run')) {
  console.log(`\n  --dry-run: nothing written. Would set version ${next}, tag v${next}, and dispatch.\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------

console.log('\nCUTTING');
const config = readFileSync(CONFIG, 'utf8');
writeFileSync(CONFIG, config.replace(/version:\s*'[^']+'/, `version: '${next}'`));
say(true, `app.config.js version → ${next}`);

git('add', 'apps/mobile/app.config.js');
git('commit', '-m', `Release ${next}\n\n${notes}`);
say(true, `committed`);

git('tag', '-a', `v${next}`, '-m', `${next}\n\n${notes}`);
say(true, `tagged v${next}`);

git('push', 'origin', 'main');
git('push', 'origin', `v${next}`);
say(true, 'pushed main and the tag');

// The tag push starts the Release workflow on its own. Dispatching as well
// would build the same commit twice and burn a build number for nothing.
console.log(`
  The Release workflow is now running for v${next}.

      gh run watch --repo mutaaf/18-0

  It builds, uploads to both stores, and pushes these notes to the listing.
  Nothing is submitted for App Review — that stays a separate, deliberate step:

      node scripts/store/submit-for-review.mjs            # preflight only
      node scripts/store/submit-for-review.mjs --submit   # the one-way door
`);
