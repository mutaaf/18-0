/**
 * The native projects must agree with `app.config.js` about who this app is.
 *
 *   node scripts/verify/native-ids.mjs
 *
 * `ios/` and `android/` are prebuild output and gitignored, and neither
 * `expo run:ios` nor `expo run:android` regenerates one that already exists. So
 * a change in `app.config.js` reaches the native project only if somebody
 * remembers to re-run prebuild, and nothing says so when they do not.
 *
 * It has already cost a release. The bundle identifier moved to
 * `com.eighteenzerodcai.app`; `ios/` was hand-edited to match and `android/`
 * was not, so a build installed from that tree still reported the old package.
 * A Play submission cut from it would have shipped an application id registered
 * nowhere, and the first sign of trouble would have been the upload being
 * rejected.
 *
 * The fix when this fails is never to edit the native file. These directories
 * are generated:
 *
 *   npx expo prebuild -p android --clean
 *   npx expo prebuild -p ios --clean
 *
 * Absent directories are not a failure -- a clone that has never prebuilt is
 * the normal state, and there is nothing to disagree with.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/mobile');

let failures = 0;
let checked = 0;

const check = (name, ok, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** What the config declares, read the way Expo reads it. */
const config = (await import(join(APP, 'app.config.js'))).default.expo;
const wanted = {
  ios: config.ios?.bundleIdentifier,
  android: config.android?.package,
  version: config.version,
};

console.log('\n18-0 — NATIVE PROJECT IDENTITY\n' + '='.repeat(64));
console.log(`\napp.config.js declares  ios ${wanted.ios} · android ${wanted.android}\n`);

// ---------------------------------------------------------------------------
// Android
// ---------------------------------------------------------------------------
const gradle = join(APP, 'android/app/build.gradle');
if (!existsSync(gradle)) {
  console.log('  · android/ not prebuilt, nothing to compare');
} else {
  checked++;
  const found = readFileSync(gradle, 'utf8').match(/applicationId\s+['"]([^'"]+)['"]/)?.[1];
  check('android applicationId matches app.config.js', found === wanted.android,
    found ? `${found}` : 'no applicationId found in build.gradle');
}

// ---------------------------------------------------------------------------
// iOS
// ---------------------------------------------------------------------------
const iosDir = join(APP, 'ios');
const xcodeproj = existsSync(iosDir)
  ? readdirSync(iosDir).find((f) => f.endsWith('.xcodeproj'))
  : undefined;

if (!xcodeproj) {
  console.log('  · ios/ not prebuilt, nothing to compare');
} else {
  checked++;
  const pbxproj = readFileSync(join(iosDir, xcodeproj, 'project.pbxproj'), 'utf8');
  // Every build configuration carries one, and a target left behind on the old
  // identifier is exactly the failure this exists to catch -- so all of them
  // have to agree, not merely the first one found.
  const ids = [...new Set(
    [...pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)]
      .map((m) => m[1].trim().replace(/^"|"$/g, ''))
      // Test hosts and extensions legitimately suffix the app's identifier.
      .filter((id) => !id.includes('$('))
      .filter((id) => !id.startsWith(`${wanted.ios}.`)),
  )];
  check('every ios PRODUCT_BUNDLE_IDENTIFIER matches app.config.js',
    ids.length === 1 && ids[0] === wanted.ios,
    ids.join(', ') || 'none found');
}

console.log('');
if (checked === 0) {
  console.log('Nothing prebuilt. Run this again after `npx expo prebuild`.\n');
  process.exit(0);
}
if (failures > 0) {
  console.error(
    `${failures} disagreement(s). Do not edit the native file -- regenerate it:\n` +
      '  npx expo prebuild -p android --clean\n' +
      '  npx expo prebuild -p ios --clean\n',
  );
  process.exit(1);
}
console.log(`${checked} native project(s) agree with app.config.js.\n`);
