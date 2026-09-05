/**
 * Push the store listing to App Store Connect.
 *
 *   set -a; . .local/asc.env; set +a
 *   node scripts/store/push-listing.mjs [--dry-run] [--version 1.0]
 *                                       [--whats-new "…" | --whats-new-file notes.txt]
 *
 * `apps/mobile/store/listing.json` is the listing. This copies it to Apple, and
 * that direction is the whole point: the console is an editable text field that
 * nothing reviews, so the description on the store and the description in the
 * repository drift the moment somebody fixes a typo in one of them.
 *
 * Running it twice writes nothing the second time. Every field is compared
 * before it is sent, partly so a re-run is cheap, but mostly so the output says
 * what actually moved — a push that reports thirteen fields written when it
 * changed none of them is a push nobody reads.
 *
 * `whatsNew` is the exception to "the file is the truth": release notes belong
 * to a release rather than to the app, so they come from the command line and
 * are left alone when nothing is passed. Apple refuses it outright on an app's
 * first version — "Attribute 'whatsNew' cannot be edited at this time", which
 * reads like a transient error and is not one: there is no previous release for
 * it to be new against. Pass it from 1.1 onward.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { asc, ascAll, patch, post, APP_ID } from './asc-client.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LISTING = join(REPO, 'apps', 'mobile', 'store', 'listing.json');

/**
 * Apple's maximums, checked here rather than discovered at review.
 *
 * An overrun comes back as a 409 "Attribute value is invalid" with a pointer at
 * `/data/attributes/keywords` and no mention of what the maximum is, so the
 * rejection names the field and leaves you to guess the rule. Worse, the fields
 * are written one entity at a time: a description that is four characters long
 * lands, and the keywords behind it do not, leaving the listing half pushed.
 * So the whole file is measured before the first request goes out.
 */
const LIMITS = {
  name: 30,
  subtitle: 30,
  description: 4000,
  keywords: 100,
  promotionalText: 170,
  whatsNew: 4000,
};

/**
 * `String.length` counts UTF-16 units, so anything outside the BMP — an emoji
 * in a promotional line — measures as two and a listing that Apple would accept
 * gets refused here for being too long.
 */
const chars = (value) => [...String(value)].length;

// The states in which Apple will accept an edit. Anything further along the
// review pipeline is frozen, and the PATCH is refused with a message about the
// state rather than about the field, which reads like a bug in this script.
const EDITABLE = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
]);

// `appStoreState` is deprecated and is already absent from some responses;
// `state` and `appVersionState` are what replaced it, per resource.
const stateOf = (entity) =>
  entity.attributes.state ?? entity.attributes.appVersionState ?? entity.attributes.appStoreState;

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const at = argv.indexOf(name);
  if (at === -1) return undefined;
  const next = argv[at + 1];
  if (next === undefined || next.startsWith('--')) {
    throw new Error(`${name} needs a value`);
  }
  return next;
};

const dryRun = flag('--dry-run');
const wantVersion = value('--version');

if (flag('--whats-new') && flag('--whats-new-file')) {
  console.error('Pass --whats-new or --whats-new-file, not both.');
  process.exit(1);
}
const notesFile = value('--whats-new-file');
// `undefined` and `''` mean different things here: nothing passed leaves the
// release notes alone, and an empty string would blank them. Only the flags
// produce a string at all.
const whatsNew = notesFile !== undefined
  ? (await readFile(notesFile, 'utf8')).trim()
  : value('--whats-new');

const listing = JSON.parse(await readFile(LISTING, 'utf8'));

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed++;
};

/** Long fields are unreadable in a diff line; the length is the useful part. */
const brief = (text) => {
  if (text === null || text === undefined || text === '') return 'empty';
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > 56 ? `"${flat.slice(0, 53)}…" (${chars(text)})` : `"${flat}"`;
};

// ---------------------------------------------------------------------------
console.log('\nLIMITS');

// Both halves are keyed by locale, so spreading them into one object would drop
// every `name` and `subtitle` behind the version block of the same locale, and
// the two fields with the tightest limits would be the two nothing measured.
const everyField = [...Object.entries(listing.appInfo), ...Object.entries(listing.version)];

for (const [locale, fields] of everyField) {
  for (const [field, text] of Object.entries(fields)) {
    if (!(field in LIMITS)) continue;
    const length = chars(text);
    check(`${locale} ${field}`, length <= LIMITS[field], `${length}/${LIMITS[field]}`);
  }
}
if (whatsNew !== undefined) {
  check('whatsNew', chars(whatsNew) <= LIMITS.whatsNew, `${chars(whatsNew)}/${LIMITS.whatsNew}`);
}

if (failed > 0) {
  // Deliberately before any request: see the note on LIMITS.
  console.log(`\n${failed} field(s) over Apple's limit. Nothing was sent.\n`);
  process.exit(1);
}

/**
 * Compare, then write only what moved, in one request per entity.
 *
 * The per-field lines are printed after the PATCH rather than before it so a
 * ✓ means the field is on the store, not that this script intended to put it
 * there.
 */
async function reconcile(prefix, entity, path, desired) {
  const current = entity.attributes;
  const same = [];
  const moved = [];

  for (const [field, want] of Object.entries(desired)) {
    if (want === undefined) continue;
    // Apple returns an unset field as null; the listing never says null.
    if ((current[field] ?? null) === want) same.push(field);
    else moved.push([field, `${brief(current[field])} → ${brief(want)}`]);
  }

  for (const field of same) check(`${prefix} ${field}`, true, 'already correct, skipped');

  if (moved.length === 0) return;

  if (dryRun) {
    for (const [field, diff] of moved) check(`${prefix} ${field}`, true, `would set  ${diff}`);
    return;
  }

  // whatsNew goes in its own request, and the reason is not tidiness. Apple
  // refuses it outright on a first version -- there is no previous release for
  // notes to be new against -- and a rejected PATCH rejects every field in it.
  // Batched, one impossible field would take the description, the keywords and
  // the promotional text down with it, on the one release where the listing is
  // being filled in for the first time.
  const groups = [
    moved.filter(([field]) => field !== 'whatsNew'),
    moved.filter(([field]) => field === 'whatsNew'),
  ].filter((group) => group.length > 0);

  for (const group of groups) {
    const changes = Object.fromEntries(group.map(([field]) => [field, desired[field]]));
    let problem = null;
    try {
      await patch(`${path}/${entity.id}`, entity.type, entity.id, changes);
    } catch (error) {
      problem = error.message;
    }

    // "cannot be edited at this time" on a first version is the API being
    // correct, not the release being broken. Say so and carry on; failing here
    // would fail a release whose build already shipped.
    const firstRelease = problem && changes.whatsNew !== undefined
      && /cannot be edited at this time/i.test(problem);

    for (const [field, diff] of group) {
      if (firstRelease) {
        check(`${prefix} ${field}`, true,
          'Apple will not take release notes on a first version — skipped');
      } else {
        check(`${prefix} ${field}`, !problem, problem ?? diff);
      }
    }
  }
}

// ---------------------------------------------------------------------------
console.log(`\nAPP INFO${dryRun ? '  (dry run)' : ''}`);

// An app carries one appInfo per review cycle: the live one and, once a change
// is in flight, the one being reviewed. Only the unsubmitted one takes an edit.
const infos = await ascAll(`/v1/apps/${APP_ID}/appInfos`);
const info = infos.find((candidate) => EDITABLE.has(stateOf(candidate)));

if (!info) {
  check('an editable appInfo exists', false,
    infos.map(stateOf).join(', ') || 'the app has none');
} else {
  console.log(`  ${info.id} (${stateOf(info)})`);
  const locales = await ascAll(`/v1/appInfos/${info.id}/appInfoLocalizations`);

  for (const [locale, fields] of Object.entries(listing.appInfo)) {
    const row = locales.find((l) => l.attributes.locale === locale);
    if (!row) {
      // Adding a locale here means adding a whole localisation — App Store
      // Connect wants the version side of it too — so this refuses rather than
      // creating half of one.
      check(`${locale}`, false, 'no localization; add the locale in App Store Connect first');
      continue;
    }
    await reconcile(locale, row, '/v1/appInfoLocalizations', {
      name: fields.name,
      subtitle: fields.subtitle,
      privacyPolicyUrl: fields.privacyPolicyUrl,
    });
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The age rating questionnaire hangs off the appInfo, not off the version, and
// it is the last thing standing between a filled-in listing and App Review.
// Leaving it out of this file would leave one compliance answer living only in
// a web form, which is the drift this whole script exists to stop.
if (info && listing.ageRating) {
  console.log(`\nAGE RATING${dryRun ? '  (dry run)' : ''}`);
  try {
    const declaration = await asc(`/v1/appInfos/${info.id}/ageRatingDeclaration`);
    await reconcile('rating', declaration.data, '/v1/ageRatingDeclarations', listing.ageRating);
  } catch (error) {
    check('the age rating declaration is reachable', false, error.message);
  }
}

console.log(`\nVERSION${dryRun ? '  (dry run)' : ''}`);

// Newest first, by creation rather than by version string: "1.10" sorts below
// "1.9" as text, and there is no reason to write a semver comparator when Apple
// already records the order the versions were made in.
const versions = (
  await ascAll(`/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=50`)
)
  .filter((candidate) => EDITABLE.has(stateOf(candidate)))
  .sort((a, b) => b.attributes.createdDate.localeCompare(a.attributes.createdDate));

const version = wantVersion
  ? versions.find((v) => v.attributes.versionString === wantVersion)
  : versions[0];

if (!version) {
  check('an editable version exists', false,
    wantVersion
      ? `no editable ${wantVersion}; editable: ${versions.map((v) => v.attributes.versionString).join(', ') || 'none'}`
      : 'every version is past the point where Apple accepts an edit');
} else {
  console.log(`  ${version.attributes.versionString} (${stateOf(version)})`);

  await reconcile(version.attributes.versionString, version, '/v1/appStoreVersions', {
    copyright: listing.copyright,
  });

  const locales = await ascAll(
    `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
  );

  for (const [locale, fields] of Object.entries(listing.version)) {
    const desired = {
      description: fields.description,
      keywords: fields.keywords,
      promotionalText: fields.promotionalText,
      marketingUrl: fields.marketingUrl,
      supportUrl: fields.supportUrl,
      whatsNew,
    };

    let row = locales.find((l) => l.attributes.locale === locale);
    if (!row) {
      // Apple creates a localization for the primary locale only, so a locale
      // added to listing.json has no row and the PATCH would 404 on an id that
      // was never there.
      if (dryRun) {
        check(`${locale}`, true, 'would be created');
        continue;
      }
      try {
        const created = await post('/v1/appStoreVersionLocalizations', {
          type: 'appStoreVersionLocalizations',
          attributes: { locale, ...desired },
          relationships: {
            appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
          },
        });
        check(`${locale}`, true, 'localization created');
        row = created.data;
      } catch (error) {
        check(`${locale}`, false, error.message);
        continue;
      }
    }

    await reconcile(locale, row, '/v1/appStoreVersionLocalizations', desired);
    if (whatsNew === undefined) {
      // Sending null here would erase the notes of the release being shipped,
      // which is a silent way to publish a blank "What's New".
      check(`${locale} whatsNew`, true, 'left as it is; pass --whats-new to set it');
    }
  }
}

// ---------------------------------------------------------------------------
console.log(
  failed === 0
    ? `\nListing ${dryRun ? 'would match' : 'matches'} apps/mobile/store/listing.json.\n`
    : `\n${failed} problem(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);
