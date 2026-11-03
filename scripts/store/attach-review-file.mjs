/**
 * Attach a file (the screen recording App Review asks for) to the editable
 * version's App Review Information.
 *
 *   node scripts/store/attach-review-file.mjs <file> [--version 1.0] [--replace]
 *
 * Apple's 2.1 "Information Needed" message asks for a recording made on a
 * physical device. It can go in a Resolution Center reply, but that thread is
 * per submission; an attachment on the review detail stays with the version and
 * is what a reviewer of the *next* submission sees too. This is the API route
 * to it, the same reserve -> upload parts -> commit-with-MD5 dance as
 * push-screenshots.mjs. `--replace` removes earlier attachments first, so a
 * re-recorded take does not sit beside the one it replaces.
 *
 * It never submits anything.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { APP_ID, asc, ascAll, patch, post } from './asc-client.mjs';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--version');
const wantVersion = argv.includes('--version') ? argv[argv.indexOf('--version') + 1] : null;
const replace = argv.includes('--replace');
if (!file) {
  console.error('usage: attach-review-file.mjs <file> [--version 1.0] [--replace]');
  process.exit(2);
}

const EDITABLE = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
  'WAITING_FOR_REVIEW',
]);
const stateOf = (v) => v.attributes.appVersionState ?? v.attributes.appStoreState;

const versions = await ascAll(`/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=50`);
const version = wantVersion
  ? versions.find((v) => v.attributes.versionString === wantVersion)
  : versions.find((v) => EDITABLE.has(stateOf(v)));
if (!version) throw new Error(`no editable iOS version${wantVersion ? ` ${wantVersion}` : ''}`);
console.log(`Version ${version.attributes.versionString} — ${stateOf(version)}`);

const detail = (await asc(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)).data;
if (!detail) throw new Error('no App Review Information yet; run submit-for-review.mjs (without --submit) first');

const buffer = readFileSync(file);
const md5 = createHash('md5').update(buffer).digest('hex');
const name = basename(file);

// A review attachment settles in UPLOAD_COMPLETE, not the COMPLETE that
// screenshots reach; waiting for COMPLETE timed out on a good upload, and a
// re-run with --replace would then have deleted it.
const DONE = new Set(['COMPLETE', 'UPLOAD_COMPLETE']);

const existing = await ascAll(`/v1/appStoreReviewDetails/${detail.id}/appStoreReviewAttachments`);
for (const a of existing) {
  // Apple reads the checksum but returns it as null, so name and size stand in.
  const sameFile =
    a.attributes.sourceFileChecksum === md5 ||
    (a.attributes.fileName === name && a.attributes.fileSize === buffer.length);
  const same = sameFile && DONE.has(a.attributes.assetDeliveryState?.state);
  if (same) {
    console.log(`  ✓ ${name} is already attached (${a.id})`);
    process.exit(0);
  }
  if (replace) {
    await asc(`/v1/appStoreReviewAttachments/${a.id}`, { method: 'DELETE' });
    console.log(`  · removed earlier attachment ${a.attributes.fileName}`);
  }
}

const reserved = await post('/v1/appStoreReviewAttachments', {
  type: 'appStoreReviewAttachments',
  attributes: { fileName: name, fileSize: buffer.length },
  relationships: { appStoreReviewDetail: { data: { type: 'appStoreReviewDetails', id: detail.id } } },
});
const id = reserved.data.id;
const ops = reserved.data.attributes.uploadOperations ?? [];
for (const op of ops) {
  const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
  const res = await fetch(op.url, { method: op.method, headers, body: buffer.subarray(op.offset, op.offset + op.length) });
  if (!res.ok) throw new Error(`${res.status} ${op.method} part at ${op.offset} — ${(await res.text()).slice(0, 300)}`);
}
// The MD5 is what Apple checks the parts against; without it the commit
// returns 200 and the asset quietly settles into FAILED.
await patch(`/v1/appStoreReviewAttachments/${id}`, 'appStoreReviewAttachments', id, {
  uploaded: true,
  sourceFileChecksum: md5,
});

// The commit returns before Apple has looked at the file.
for (let i = 0; i < 60; i++) {
  const { data } = await asc(`/v1/appStoreReviewAttachments/${id}`);
  const state = data.attributes.assetDeliveryState?.state;
  if (DONE.has(state)) {
    console.log(`  ✓ attached ${name} — ${ops.length} part(s), ${(buffer.length / 1e6).toFixed(1)} MB`);
    process.exit(0);
  }
  if (state === 'FAILED') {
    console.error(`  ✗ ${name} FAILED: ${JSON.stringify(data.attributes.assetDeliveryState.errors ?? [])}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.error(`  ? ${name} still processing after 3 minutes; re-run to check`);
process.exit(1);
