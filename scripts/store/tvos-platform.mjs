#!/usr/bin/env node
/**
 * Give the App Store record an Apple TV platform, if it has none.
 *
 *   set -a; . .local/asc.env; set +a
 *   node scripts/store/tvos-platform.mjs            # version from app.config.js
 *
 * App Store Connect refuses a tvOS upload for a record without a tvOS version
 * ("No version found for 'Apple TV'"), so the first TestFlight build of the TV
 * app needs this once. It is the API's form of "Add Platform" on the app page:
 * it creates an editable TV_OS App Store version and nothing else. It does not
 * attach a build, fill the listing or submit anything -- the store stays the
 * owner's decision. Once two platforms are approved the app is a universal
 * purchase, and Apple never lets a platform be removed again.
 */
import { createRequire } from 'node:module';
import { asc, post, APP_ID } from './asc-client.mjs';

const require = createRequire(import.meta.url);
const version = process.argv[2] ?? require('../../apps/mobile/app.config.js').expo.version;

const { data } = await asc(`/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=TV_OS&fields[appStoreVersions]=versionString,appStoreState`);
if (data.length > 0) {
  for (const v of data) console.log(`tvOS already on the record: ${v.attributes.versionString} (${v.attributes.appStoreState})`);
  process.exit(0);
}
const made = await post('/v1/appStoreVersions', {
  type: 'appStoreVersions',
  attributes: { platform: 'TV_OS', versionString: version },
  relationships: { app: { data: { type: 'apps', id: APP_ID } } },
});
console.log(`added tvOS ${made.data.attributes.versionString} (${made.data.attributes.appStoreState})`);
