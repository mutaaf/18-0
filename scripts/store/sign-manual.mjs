#!/usr/bin/env node
/**
 * Switch the app target -- and only the app target -- to manual signing with
 * the distribution profile.
 *
 *   node scripts/store/sign-manual.mjs ios/X.xcodeproj <team> <profile uuid> <bundle id>
 *
 * Passing CODE_SIGN_STYLE / PROVISIONING_PROFILE_SPECIFIER on the xcodebuild
 * command line applies them to every target in the workspace, Pods included,
 * and a pod's resource bundle cannot be signed with an app's profile: the
 * archive fails on a target nobody meant to sign. So this edits the project
 * prebuild just generated (never committed): the build configurations that
 * carry the app's bundle identifier are the app target's, and nothing else
 * in a prebuild project has it.
 *
 * Text, not the xcodeproj Ruby gem: that gem's dependency resolution broke
 * differently on a laptop and a runner, and the edit is four keys.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [proj, team, uuid, bundleId] = process.argv.slice(2);
if (!proj || !team || !uuid || !bundleId) {
  console.error('usage: sign-manual.mjs <xcodeproj> <team> <profile uuid> <bundle id>');
  process.exit(2);
}
const file = `${proj}/project.pbxproj`;
const src = readFileSync(file, 'utf8');

const SIGNING = /^\s*("?CODE_SIGN_STYLE"?|"?DEVELOPMENT_TEAM"?|"?CODE_SIGN_IDENTITY(\[[^\]]*\])?"?|"?PROVISIONING_PROFILE_SPECIFIER"?|"?PROVISIONING_PROFILE"?)\s*=.*;\n/gm;
let edited = 0;
const out = src.replace(/(buildSettings = \{\n)([\s\S]*?)(\n\t*\};)/g, (whole, open, body, close) => {
  if (!new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = "?${bundleId.replace(/\./g, '\\.')}"?;`).test(body)) return whole;
  edited++;
  const indent = body.match(/^(\t+)/)?.[1] ?? '\t\t\t\t';
  const kept = `${body}\n`.replace(SIGNING, '').replace(/\n$/, '');
  const add = [
    `CODE_SIGN_STYLE = Manual;`,
    `DEVELOPMENT_TEAM = ${team};`,
    `CODE_SIGN_IDENTITY = "Apple Distribution";`,
    `"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";`,
    `PROVISIONING_PROFILE_SPECIFIER = "${uuid}";`,
  ].map((l) => indent + l).join('\n');
  return `${open}${add}\n${kept}${close}`;
});

if (edited === 0) {
  console.error(`no build configuration with PRODUCT_BUNDLE_IDENTIFIER = ${bundleId} in ${file}`);
  process.exit(1);
}
writeFileSync(file, out);
console.log(`manual signing on ${edited} configuration(s), profile ${uuid}`);
