#!/usr/bin/env node
/**
 * The tvOS App Store provisioning profile, made if it is missing.
 *
 *   set -a; . .local/asc.env; set +a
 *   node scripts/store/tvos-profile.mjs --out .local/ios-credentials/tvos-profile.mobileprovision
 *   base64 -i .local/ios-credentials/tvos-profile.mobileprovision | gh secret set TVOS_PROVISIONING_PROFILE_BASE64
 *
 * The Apple TV app is the same bundle id as the iPhone app (one App Store
 * record, universal purchase), but a profile is per platform: the "18-0 App
 * Store" profile is IOS_APP_STORE and Xcode refuses it for an appletvos
 * archive. This finds or creates the TVOS_APP_STORE twin, signed by every
 * distribution certificate on the team so whichever .p12 the workflow holds
 * matches it, and writes it out. A profile is not a secret -- it is a list of
 * certificates and a bundle id -- but it lives beside the .p12 it goes with.
 *
 * It never touches the iOS profile, the certificates or the app record.
 */
import { writeFileSync } from 'node:fs';
import { asc, post } from './asc-client.mjs';

const BUNDLE = 'com.eighteenzerodcai.app';
const NAME = '17-0 tvOS App Store';

const args = process.argv.slice(2);
const out = args[args.indexOf('--out') + 1];
if (!args.includes('--out') || !out) {
  console.error('usage: tvos-profile.mjs --out <file.mobileprovision>');
  process.exit(2);
}

const { data: ids } = await asc(`/v1/bundleIds?filter[identifier]=${BUNDLE}&fields[bundleIds]=identifier,platform`);
const bundle = ids.find((b) => b.attributes.identifier === BUNDLE);
if (!bundle) throw new Error(`no bundle id ${BUNDLE} on this team`);

const { data: profiles } = await asc(
  `/v1/bundleIds/${bundle.id}/profiles?fields[profiles]=name,profileType,profileState,profileContent,uuid,expirationDate`,
);
let profile = profiles.find((p) => p.attributes.profileType === 'TVOS_APP_STORE' && p.attributes.profileState === 'ACTIVE');

if (profile) {
  console.error(`found ${profile.attributes.name} (${profile.attributes.uuid}), expires ${profile.attributes.expirationDate}`);
} else {
  const { data: certs } = await asc('/v1/certificates?filter[certificateType]=DISTRIBUTION&fields[certificates]=name,expirationDate');
  if (certs.length === 0) throw new Error('no distribution certificate on this team');
  const { data } = await post('/v1/profiles', {
    type: 'profiles',
    attributes: { name: NAME, profileType: 'TVOS_APP_STORE' },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: bundle.id } },
      certificates: { data: certs.map((c) => ({ type: 'certificates', id: c.id })) },
    },
  });
  profile = data;
  console.error(`created ${profile.attributes.name} (${profile.attributes.uuid}) with ${certs.length} certificate(s)`);
}

writeFileSync(out, Buffer.from(profile.attributes.profileContent, 'base64'));
console.error(`wrote ${out}`);
