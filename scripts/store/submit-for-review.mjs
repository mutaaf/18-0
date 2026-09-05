/**
 * Attach a build to an App Store version and put it in front of App Review.
 *
 *   node scripts/store/submit-for-review.mjs             # preflight only — safe
 *   node scripts/store/submit-for-review.mjs --submit    # actually submits
 *
 * READ THIS BEFORE PASSING --submit. Submitting is a one-way door: it wakes a
 * human reviewer at Apple, and a rejection is written to the account's record
 * where it stays. There is no unsend. So the default is everything *except*
 * the submit — the build is attached, the review details are written, the
 * release type is set, and then it stops and prints what it would have sent.
 * Only `--submit` performs the last step.
 *
 * Steps 1-6 are each skipped when they are already done, so this is safe to run
 * repeatedly while the metadata is still being filled in; that is the expected
 * way to use it.
 *
 * Flags:
 *   --version <string>   target a version explicitly, e.g. --version 1.0
 *   --build <number>     attach a specific build rather than the newest valid one
 *   --notes-file <path>  review notes to send instead of the default below
 *   --manual             releaseType MANUAL instead of AFTER_APPROVAL
 *   --submit             perform step 7
 *
 * Contact details come from the environment rather than from this file, because
 * a phone number does not belong in a repository:
 *
 *   ASC_CONTACT_FIRST_NAME  ASC_CONTACT_LAST_NAME
 *   ASC_CONTACT_PHONE       ASC_CONTACT_EMAIL
 *
 * along with the three credentials `asc-client.mjs` documents:
 *
 *   set -a; . .local/asc.env; set +a
 */
import { readFileSync } from 'node:fs';

import { asc, ascAll, patch, post, APP_ID } from './asc-client.mjs';

// ---------------------------------------------------------------------------
// Arguments

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};

const WANT_VERSION = value('--version');
const WANT_BUILD = value('--build');
const NOTES_FILE = value('--notes-file');
const RELEASE_TYPE = has('--manual') ? 'MANUAL' : 'AFTER_APPROVAL';
const SUBMIT = has('--submit');

/**
 * The text from the "App Store — Review notes" section of `docs/submission.md`,
 * flattened to plain text because App Review Information is a plain textarea and
 * renders markdown as literal asterisks.
 *
 * Keep the two in step. If the build going up has sign-in switched off
 * (`EXPO_PUBLIC_AUTH_PROVIDERS` unset), the two sign-in paragraphs describe
 * buttons a reviewer will not find — write the shortened version to a file and
 * pass `--notes-file`, as that doc's own caveat says.
 */
const DEFAULT_NOTES = `No demo account is needed. The app signs you in anonymously on first launch, with no prompt and no sign-up screen. Every mode is playable immediately, ranked seasons included, and none of it asks for an account.

Signing in is optional. The account panel offers Sign in with Apple and Google, and nothing in the game is gated behind either. What it buys is history: the provider is linked to the anonymous account already in use, so the seasons already played carry over rather than being replaced, and they survive losing the device. It is also what puts a ranked season on the public board: anonymous accounts are free and unlimited, so the board lists only seasons attached to a signed-in one. Playing is never affected either way.

Guideline 4.8. Sign in with Apple is offered wherever Google is, and this is enforced in code rather than left to configuration: if the provider list names Google without Apple, iOS shows no sign-in buttons at all.

Guideline 5.1.1(v). Account deletion is in the app. Tap the avatar disc in the top-right corner of any screen to open Account; "Delete my account" is at the bottom of that screen. It needs no sign-in, no email and no contact with support. It removes the account, the display name, every ranked season attached to it, and the analytics for that account.

Guideline 1.2. The only user-generated content is a display name shown on the leaderboard. Names are checked against a denylist by the database when they are set, so a blocked name is refused rather than published and reviewed later. Every leaderboard row carries a report control, and a reported name can be hidden from the board.

No ads, no in-app purchases, no gambling, no messaging between players. The game works with no network connection; only the leaderboard needs one.`;

const NOTES = NOTES_FILE ? readFileSync(NOTES_FILE, 'utf8').trim() : DEFAULT_NOTES;

const die = (message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
};

const contact = (name) =>
  process.env[name] ??
  die(`${name} is not set. App Review needs a real person to call, and this script will not invent one. Export it, or add it to .local/asc.env:\n\n    export ${name}="…"`);

// A step that changed nothing prints "already", so a second run reads as a
// no-op rather than as a repeat of the first.
const step = (label, changed) => console.log(`  ${changed ? '→' : '·'} ${label}`);

// Apple's rejections are one useful sentence ("The phone number must be in a
// valid format…") wrapped in a Node stack trace that buries it. The trace says
// nothing here — every throw comes from the same line of the client.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (problem) => die(problem?.message ?? String(problem)));
}

// ---------------------------------------------------------------------------
// 1. The version

console.log(`\nAPP ${APP_ID}`);

// The states in which Apple will still accept an edit. Anything else — in
// review, pending release, on sale — rejects every PATCH below with an error
// that talks about the attribute rather than about the state.
const EDITABLE = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
]);

// A version that shipped. `whatsNew` is required only once one of these exists;
// on a first release Apple has nowhere to show release notes and refuses them.
const RELEASED = new Set([
  'READY_FOR_SALE',
  'PENDING_DEVELOPER_RELEASE',
  'PENDING_APPLE_RELEASE',
  'PROCESSING_FOR_APP_STORE',
  'REPLACED_WITH_NEW_VERSION',
  'REMOVED_FROM_SALE',
]);

const versions = await ascAll(`/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=50`);
const stateOf = (v) => v.attributes.appStoreState ?? v.attributes.appVersionState;

const version = WANT_VERSION
  ? versions.find((v) => v.attributes.versionString === WANT_VERSION)
  : versions.find((v) => EDITABLE.has(stateOf(v)));

if (!version) {
  die(
    WANT_VERSION
      ? `No IOS version ${WANT_VERSION}. There is ${versions.map((v) => `${v.attributes.versionString} (${stateOf(v)})`).join(', ') || 'none at all'}.`
      : `No editable IOS version. There is ${versions.map((v) => `${v.attributes.versionString} (${stateOf(v)})`).join(', ') || 'none at all'}. Create one in App Store Connect first.`,
  );
}
if (!EDITABLE.has(stateOf(version))) {
  die(`Version ${version.attributes.versionString} is ${stateOf(version)}, which Apple will not let anything edit.`);
}

const VERSION_ID = version.id;
const hasReleasedBefore = versions.some((v) => v.id !== VERSION_ID && RELEASED.has(stateOf(v)));

console.log(`Version ${version.attributes.versionString} — ${stateOf(version)}`);

// ---------------------------------------------------------------------------
// 2. The build

const builds = await ascAll(
  `/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=50` +
    (WANT_BUILD ? `&filter[version]=${encodeURIComponent(WANT_BUILD)}` : ''),
);
if (builds.length === 0) {
  die(WANT_BUILD ? `No build ${WANT_BUILD} for this app.` : 'This app has no builds. Upload one first.');
}

// This is the single most common way an otherwise-correct submission fails, and
// Apple's answer to attaching a processing build names neither the build nor the
// state — it comes back as a generic relationship error. So say it here.
const newest = builds[0];
if (newest.attributes.processingState === 'PROCESSING') {
  die(
    `Build ${newest.attributes.version} (uploaded ${newest.attributes.uploadedDate}) is still PROCESSING.\n` +
      `  Apple will not let it be attached to a version until that finishes — usually minutes, sometimes an hour.\n` +
      `  Wait and re-run, or pass --build <number> to attach an older build that is already VALID.`,
  );
}

const build = builds.find((b) => b.attributes.processingState === 'VALID');
if (!build) {
  die(
    `No VALID build. The newest is ${newest.attributes.version} (${newest.attributes.processingState}).\n` +
      `  INVALID and FAILED builds are rejected at upload; check the email Apple sent and upload another.`,
  );
}
console.log(`Build ${build.attributes.version} — ${build.attributes.processingState}, uploaded ${build.attributes.uploadedDate}`);

// ---------------------------------------------------------------------------
// 3. Attach it

console.log('\nPREPARING');

const attached = (await asc(`/v1/appStoreVersions/${VERSION_ID}/relationships/build`)).data;
if (attached?.id === build.id) {
  step(`build ${build.attributes.version} is already attached`, false);
} else {
  await asc(`/v1/appStoreVersions/${VERSION_ID}/relationships/build`, {
    method: 'PATCH',
    body: JSON.stringify({ data: { type: 'builds', id: build.id } }),
  });
  step(`attached build ${build.attributes.version}`, true);
}

// ---------------------------------------------------------------------------
// 4. Review details

const REVIEW = {
  contactFirstName: contact('ASC_CONTACT_FIRST_NAME'),
  contactLastName: contact('ASC_CONTACT_LAST_NAME'),
  contactPhone: contact('ASC_CONTACT_PHONE'),
  contactEmail: contact('ASC_CONTACT_EMAIL'),
  // There is deliberately nothing for a reviewer to log into, and the notes say
  // so; leaving this unanswered is what makes a reviewer ask for credentials.
  demoAccountRequired: false,
  notes: NOTES,
};

const existingDetail = (await asc(`/v1/appStoreVersions/${VERSION_ID}/appStoreReviewDetail`)).data;
if (!existingDetail) {
  await post('/v1/appStoreReviewDetails', {
    type: 'appStoreReviewDetails',
    attributes: REVIEW,
    relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: VERSION_ID } } },
  });
  step('created the review detail (contact + notes)', true);
} else if (Object.entries(REVIEW).every(([k, v]) => existingDetail.attributes[k] === v)) {
  step('review detail already says this', false);
} else {
  await patch(
    `/v1/appStoreReviewDetails/${existingDetail.id}`,
    'appStoreReviewDetails',
    existingDetail.id,
    REVIEW,
  );
  step('updated the review detail (contact + notes)', true);
}

// ---------------------------------------------------------------------------
// 5. Release type

if (version.attributes.releaseType === RELEASE_TYPE) {
  step(`release type is already ${RELEASE_TYPE}`, false);
} else {
  await patch(`/v1/appStoreVersions/${VERSION_ID}`, 'appStoreVersions', VERSION_ID, {
    releaseType: RELEASE_TYPE,
  });
  step(`release type set to ${RELEASE_TYPE}`, true);
}

// ---------------------------------------------------------------------------
// 6. Preflight
//
// Every one of these is something Apple checks at submit time and reports as a
// single opaque "not ready" — it does not say which of them is missing, which
// is the reason this list exists at all.

console.log('\nPREFLIGHT');

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed++;
};

const locales = await ascAll(`/v1/appStoreVersions/${VERSION_ID}/appStoreVersionLocalizations`);
const primary = locales.find((l) => l.attributes.locale === 'en-US') ?? locales[0];

check('a build is attached', true, `build ${build.attributes.version}`);
check('review contact and notes are set', true, `${REVIEW.contactEmail}, ${NOTES.length} chars of notes`);

check(
  'the description is written',
  Boolean(primary?.attributes.description?.trim()),
  primary ? `${(primary.attributes.description ?? '').length} chars in ${primary.attributes.locale}` : 'no localization at all',
);
check(
  'keywords are set',
  Boolean(primary?.attributes.keywords?.trim()),
  primary?.attributes.keywords ?? 'empty',
);

// A screenshot row can exist with nothing uploaded into it, and an upload that
// was never committed sits at UPLOAD_COMPLETE forever without ever reaching the
// store — so this counts assets Apple calls COMPLETE, not sets.
let complete = 0;
let sets = 0;
for (const locale of locales) {
  for (const set of await ascAll(`/v1/appStoreVersionLocalizations/${locale.id}/appScreenshotSets`)) {
    sets++;
    for (const shot of await ascAll(`/v1/appScreenshotSets/${set.id}/appScreenshots`)) {
      if (shot.attributes.assetDeliveryState?.state === 'COMPLETE') complete++;
    }
  }
}
check('a screenshot set has a finished asset', complete > 0, `${complete} complete in ${sets} set(s)`);

// Apple rejects release notes on a first release rather than requiring them,
// so an empty whatsNew here is correct and saying "missing" would be a lie.
if (hasReleasedBefore) {
  check("what's new is written", Boolean(primary?.attributes.whatsNew?.trim()), `${(primary?.attributes.whatsNew ?? '').length} chars`);
} else {
  check("what's new", true, 'not required — no previously released version');
}

// The declaration hangs off appInfo, not the version, and every answer starts
// null; `ageRatingOverride` defaults to NONE whether or not anybody answered,
// so it cannot be used to tell an answered questionnaire from an untouched one.
const [appInfo] = await ascAll(`/v1/apps/${APP_ID}/appInfos`);
const declaration = appInfo
  ? (await asc(`/v1/appInfos/${appInfo.id}/ageRatingDeclaration`)).data
  : null;
const answers = Object.entries(declaration?.attributes ?? {}).filter(
  ([k, v]) => !k.startsWith('ageRating') && !k.startsWith('koreaAgeRating') && v !== null,
);
check(
  'the age rating questionnaire is answered',
  answers.length > 0,
  answers.length > 0 ? `${answers.length} answers` : 'every answer is null — fill it in on the App Information page',
);

// Export compliance is answered on the *build*, and a build uploaded without
// ITSAppUsesNonExemptEncryption in its Info.plist arrives with it null and
// blocks the submission until somebody answers it by hand.
check(
  'export compliance is answered',
  build.attributes.usesNonExemptEncryption !== null && build.attributes.usesNonExemptEncryption !== undefined,
  build.attributes.usesNonExemptEncryption === false
    ? 'uses no non-exempt encryption'
    : String(build.attributes.usesNonExemptEncryption),
);

// ---------------------------------------------------------------------------
// 7. Submit — only ever on an explicit --submit

const summary =
  `version ${version.attributes.versionString} with build ${build.attributes.version}, ` +
  `releasing ${RELEASE_TYPE === 'MANUAL' ? 'manually' : 'automatically after approval'}`;

if (!SUBMIT) {
  console.log(
    failed === 0
      ? '\nReady. Nothing has been submitted.'
      : `\n${failed} problem(s). Nothing has been submitted.`,
  );
  console.log(`\nWould submit: ${summary}.`);
  console.log('This step notifies Apple, starts a review and writes any rejection to the');
  console.log('account\'s record — there is no way to take it back. To actually do it:\n');
  console.log(`    node scripts/store/submit-for-review.mjs${WANT_VERSION ? ` --version ${WANT_VERSION}` : ''}${WANT_BUILD ? ` --build ${WANT_BUILD}` : ''}${has('--manual') ? ' --manual' : ''} --submit\n`);
  process.exit(failed === 0 ? 0 : 1);
}

if (failed > 0) die(`${failed} preflight problem(s) above. Fix them rather than letting App Review find them.`);

console.log(`\nSUBMITTING — ${summary}`);

/** The current API: a submission is a container, versions are items in it. */
async function submitViaReviewSubmissions() {
  // An unsubmitted container from an earlier run is reused; a second one for the
  // same app is refused by Apple with a duplicate error that does not mention
  // the first.
  const open = await ascAll(
    `/v1/reviewSubmissions?filter[app]=${APP_ID}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`,
  );
  let submission = open[0];
  if (submission) {
    step(`reusing review submission ${submission.id}`, false);
  } else {
    submission = (
      await post('/v1/reviewSubmissions', {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      })
    ).data;
    step(`created review submission ${submission.id}`, true);
  }

  const items = await ascAll(`/v1/reviewSubmissions/${submission.id}/items?include=appStoreVersion`);
  const already = items.some((i) => i.relationships?.appStoreVersion?.data?.id === VERSION_ID);
  if (already) {
    step('the version is already an item on it', false);
  } else {
    await post('/v1/reviewSubmissionItems', {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: VERSION_ID } },
      },
    });
    step('added the version to it', true);
  }

  await patch(`/v1/reviewSubmissions/${submission.id}`, 'reviewSubmissions', submission.id, {
    submitted: true,
  });
  return `reviewSubmissions (${submission.id})`;
}

/** The older per-version endpoint, still the only one that works for some apps. */
async function submitViaVersionSubmission() {
  const { data } = await post('/v1/appStoreVersionSubmissions', {
    type: 'appStoreVersionSubmissions',
    relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: VERSION_ID } } },
  });
  return `appStoreVersionSubmissions (${data.id})`;
}

let used;
try {
  used = await submitViaReviewSubmissions();
} catch (problem) {
  console.log(`  · reviewSubmissions did not work for this app — ${problem.message}`);
  console.log('  · falling back to appStoreVersionSubmissions');
  used = await submitViaVersionSubmission();
}

console.log(`\n✓ Submitted for review via ${used}.`);
console.log('Apple has it now. Watch for the state change in App Store Connect or by email.\n');
