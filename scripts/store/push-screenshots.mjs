/**
 * Push the committed App Store screenshots to App Store Connect.
 *
 *   set -a; . .local/asc.env; set +a
 *   node scripts/store/push-screenshots.mjs [--dry-run] [--only ios-6.9|ipad-12.9]
 *
 * Uploading a screenshot is four calls, not one, and every one of them fails
 * unhelpfully when skipped — so this exists rather than a line in a release
 * checklist that somebody performs by hand at midnight:
 *
 *   1. find the editable appStoreVersion and its en-US localization
 *   2. get or create the appScreenshotSet for the display type
 *   3. POST /v1/appScreenshots to reserve the asset, then PUT every part of
 *      the `uploadOperations` plan it hands back
 *   4. PATCH it `uploaded: true` *with the file's MD5*
 *
 * Re-running is safe: a screenshot already in the set under the same name and
 * already COMPLETE is left alone, and anything else with that name is deleted
 * before it is replaced. Nothing here duplicates.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asc, ascAll, patch, post, APP_ID } from './asc-client.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = join(ROOT, 'apps/mobile/assets/store/screenshots');

/**
 * The display types, verified against the API rather than remembered.
 *
 * `screenshotDisplayType` is a closed enum, and POSTing a value outside it
 * returns a 409 that lists every value Apple accepts. That list is the source
 * of truth used here, and it holds two surprises:
 *
 *  - There is no APP_IPHONE_69. The iPhone family stops at APP_IPHONE_67, and
 *    1290x2796 — the size Apple's own guidelines print under the "6.9-inch"
 *    heading — is what that slot takes. The directory is named for the device
 *    Apple markets; the API is named for the slot. They do not have to agree.
 *  - There is no APP_IPAD_13 either. The 13" iPad Pro submits through
 *    APP_IPAD_PRO_3GEN_129 at 2048x2732. APP_IPAD_PRO_129 is the retired
 *    2nd-gen slot at the same pixel size — same dimensions, wrong shelf, and
 *    Apple accepts the upload without ever saying so.
 *
 * `width`/`height` are asserted against the PNG header before anything is
 * uploaded, because a mis-sized file is accepted by all four calls above and
 * only fails at the very end, as a FAILED asset with no picture in the console.
 */
const TARGETS = {
  'ios-6.9': { displayType: 'APP_IPHONE_67', width: 1290, height: 2796, label: 'iPhone 6.9"' },
  'ipad-12.9': { displayType: 'APP_IPAD_PRO_3GEN_129', width: 2048, height: 2732, label: 'iPad Pro 12.9"' },
};

/** Screenshots can only be changed while the version is still being written. */
const EDITABLE = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
]);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyAt = args.indexOf('--only');
const only = onlyAt === -1 ? null : args[onlyAt + 1];

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed++;
  return ok;
};
const note = (label, detail = '') => console.log(`  · ${label}${detail ? `  — ${detail}` : ''}`);

if (onlyAt !== -1 && !TARGETS[only]) {
  console.error(
    `\n--only takes one of: ${Object.keys(TARGETS).join(', ')}\n` +
      `(play-phone is Google Play's; it is not an App Store size and has no display type.)\n`,
  );
  process.exit(2);
}
const chosen = only ? [only] : Object.keys(TARGETS);

/**
 * Read the real pixel size out of the PNG's IHDR, which is always the first
 * chunk: 8-byte signature, 4-byte length, "IHDR", then width and height as
 * big-endian 32-bit. Trusting the directory name here is how a re-export at
 * the wrong scale reaches Apple.
 */
function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Run one `uploadOperation`.
 *
 * The URL is pre-signed and the headers Apple hands back are the *complete*
 * set it signed for. Adding our own — an `authorization` bearer especially,
 * which every other call in this file needs — invalidates the signature, so
 * this deliberately uses bare fetch instead of the client's `asc`.
 */
async function uploadPart(file, op) {
  const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
  const res = await fetch(op.url, {
    method: op.method,
    headers,
    body: file.subarray(op.offset, op.offset + op.length),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${op.method} part at offset ${op.offset} — ${(await res.text()).slice(0, 300)}`);
  }
}

/**
 * Wait for Apple to finish looking at the asset.
 *
 * The PATCH that commits the upload returns 200 long before anything has been
 * validated: the state is UPLOAD_COMPLETE, and it becomes COMPLETE or FAILED
 * some seconds later. Reporting success at the PATCH is why a push can look
 * clean and leave five broken images in the console.
 */
async function settle(id) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const { data } = await asc(`/v1/appScreenshots/${id}`);
    const state = data.attributes.assetDeliveryState ?? {};
    if (state.state && state.state !== 'UPLOAD_COMPLETE' && state.state !== 'AWAITING_UPLOAD') return state;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { state: 'TIMED_OUT', errors: [{ description: 'still processing after 60s' }] };
}

const describeErrors = (state) =>
  (state.errors ?? []).map((e) => e.description ?? e.code ?? JSON.stringify(e)).join('; ');

// ---------------------------------------------------------------------------
console.log(`\nVERSION${dryRun ? '  (dry run — nothing will be written)' : ''}`);

const versions = await ascAll(`/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=50`);
const version = versions.find((v) => EDITABLE.has(v.attributes.appStoreState));

if (!version) {
  check(
    'there is an editable iOS version',
    false,
    versions.length
      ? `found ${versions.map((v) => `${v.attributes.versionString} ${v.attributes.appStoreState}`).join(', ')}`
      : `app ${APP_ID} has no iOS versions`,
  );
  process.exit(1);
}
check(`version ${version.attributes.versionString} is editable`, true, version.attributes.appStoreState);

const locales = await ascAll(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
const locale = locales.find((l) => l.attributes.locale === 'en-US');
if (!check('it has an en-US localization', Boolean(locale), locales.map((l) => l.attributes.locale).join(' '))) {
  process.exit(1);
}

const sets = await ascAll(`/v1/appStoreVersionLocalizations/${locale.id}/appScreenshotSets`);

for (const key of chosen) {
  const target = TARGETS[key];
  console.log(`\n${key.toUpperCase()}  ${target.label}  ${target.width}x${target.height}  ${target.displayType}`);

  const names = (await readdir(join(SHOTS, key)))
    .filter((n) => n.endsWith('.png'))
    // Apple renders a set in `appScreenshots` order, and the numeric prefixes
    // are the order the screens were written to be read in. A plain sort puts
    // 10 before 2; there are only five, but the prefix is what carries intent.
    .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b));

  if (!check(`${names.length} screenshot(s) on disk`, names.length > 0, names.join(' '))) continue;

  const files = new Map();
  let sized = true;
  for (const name of names) {
    const buffer = await readFile(join(SHOTS, key, name));
    const size = pngSize(buffer);
    const ok = size?.width === target.width && size?.height === target.height;
    if (!ok) {
      check(`${name} is ${target.width}x${target.height}`, false,
        size ? `it is ${size.width}x${size.height}, which ${target.displayType} will reject` : 'not a PNG');
      sized = false;
    }
    files.set(name, buffer);
  }
  if (!sized) {
    note('skipping this size — nothing uploaded', 'fix the assets and re-run');
    continue;
  }
  check('every file is the exact store size', true, `${names.length} × ${target.width}x${target.height}`);

  let set = sets.find((s) => s.attributes.screenshotDisplayType === target.displayType);
  if (!set) {
    if (dryRun) {
      note(`would create an appScreenshotSet for ${target.displayType}`);
    } else {
      const created = await post('/v1/appScreenshotSets', {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: target.displayType },
        relationships: {
          appStoreVersionLocalization: {
            data: { type: 'appStoreVersionLocalizations', id: locale.id },
          },
        },
      });
      set = created.data;
      check('created the screenshot set', true, set.id);
    }
  } else {
    check('the screenshot set already exists', true, set.id);
  }

  const existing = set ? await ascAll(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`) : [];
  const ordered = [];

  for (const name of names) {
    const buffer = files.get(name);
    const already = existing.find((s) => s.attributes.fileName === name);
    const state = already?.attributes.assetDeliveryState?.state;

    if (already && state === 'COMPLETE') {
      note(`${name} is already up`, already.id);
      ordered.push(already.id);
      continue;
    }

    if (already) {
      // A half-uploaded or FAILED asset holds the name and cannot be repaired
      // in place; the console shows it as a broken image forever otherwise.
      if (dryRun) note(`would replace ${name}`, state ?? 'no delivery state');
      else {
        await asc(`/v1/appScreenshots/${already.id}`, { method: 'DELETE' });
        note(`removed the previous ${name}`, state ?? 'no delivery state');
      }
    }

    if (dryRun) {
      note(`would upload ${name}`, `${Math.round(buffer.length / 1024)} KB`);
      continue;
    }

    const reserved = await post('/v1/appScreenshots', {
      type: 'appScreenshots',
      attributes: { fileName: name, fileSize: buffer.length },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
    });
    const id = reserved.data.id;
    const operations = reserved.data.attributes.uploadOperations ?? [];

    for (const op of operations) await uploadPart(buffer, op);

    // The MD5 is not optional and not checked at PATCH time. Omit it and the
    // call still returns 200, then the asset settles into FAILED and the
    // console renders a broken thumbnail with no explanation anywhere.
    await patch(`/v1/appScreenshots/${id}`, 'appScreenshots', id, {
      uploaded: true,
      sourceFileChecksum: createHash('md5').update(buffer).digest('hex'),
    });

    const settled = await settle(id);
    check(
      `${name} delivered`,
      settled.state === 'COMPLETE',
      settled.state === 'COMPLETE'
        ? `${operations.length} part(s), ${Math.round(buffer.length / 1024)} KB`
        : `${settled.state}: ${describeErrors(settled) || 'no reason given'}`,
    );
    if (settled.state === 'COMPLETE') ordered.push(id);
  }

  if (dryRun || ordered.length < 2) continue;

  // Uploads land in whatever order they finished. The store shows the set in
  // relationship order, so it is restated explicitly from the filenames.
  await asc(`/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
    method: 'PATCH',
    body: JSON.stringify({ data: ordered.map((id) => ({ type: 'appScreenshots', id })) }),
  });
  check('ordered as numbered', true, names.join(' → '));
}

console.log(failed === 0 ? '\nScreenshots are up.\n' : `\n${failed} problem(s).\n`);
process.exit(failed === 0 ? 0 : 1);
