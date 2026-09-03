/**
 * Capture the store screenshots, at the exact sizes each store demands.
 *
 *   cd apps/mobile && node scripts/make-store-screenshots.mjs
 *
 * These are shot against the *deployed* site rather than a local build, which
 * is the whole reason this is a script and not a folder of files somebody
 * dragged out of a simulator: the listing should show what players actually
 * get, and it should be re-shootable in a minute when a screen changes.
 *
 * Native resolution, not upscaled. A phone screenshot taken by resizing a
 * desktop window and enlarging it looks exactly as bad as it sounds at the size
 * a store renders it. Playwright gives a real viewport and a device scale
 * factor, so 430x932 at 3x is 1290x2796 on the nose.
 *
 * Requires playwright-core and a Chrome on the machine; neither is a project
 * dependency, because this runs by hand a handful of times a year:
 *
 *   npm i -g playwright-core   # or npx, or a scratch directory
 *
 * Env: SITE (default https://18-0.co), OUT, and DEV / ONLY to shoot a single
 * device or scene while iterating.
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const SITE = process.env.SITE ?? 'https://18-0.co';
const OUT = process.env.OUT ?? './assets/store/screenshots';

/**
 * Exactly what each store demands, and the CSS viewport that lands on it.
 *
 * The iPad entry is not optional while `app.config.js` says
 * `supportsTablet: true` — App Store Connect refuses the submission without
 * 12.9" screenshots, and the cheaper fix is to turn tablet support off.
 *
 * Play is the odd one: it rejects anything more extreme than 2:1, and the
 * iPhone 6.9" shape is 2.17:1. So the phone set is shot again at 16:9 rather
 * than resized, which would letterbox or crop the UI.
 */
const DEVICES = {
  'ios-6.9': { w: 430, h: 932, scale: 3 }, //    1290 x 2796
  'ipad-12.9': { w: 1024, h: 1366, scale: 2 }, // 2048 x 2732
  'play-phone': { w: 360, h: 640, scale: 3 }, //  1080 x 1920
};

/** react-native-web animates in, and a screenshot of a half-faded screen ships. */
const settle = (page, ms = 1400) => page.waitForTimeout(ms);

/**
 * One screen per thing the game actually does, in listing order.
 *
 * Every scene reloads rather than navigating on from the last one. Spins come
 * from the server and the franchise and era they return are different every
 * time, so a scene that depended on the previous scene's state would produce a
 * different picture on every run and occasionally a broken one.
 *
 * `waitUntil: 'load'` rather than `'networkidle'`: the app holds connections
 * open, so networkidle times out on the larger viewports and hands back a blank
 * page having "succeeded".
 */
const SCENES = [
  {
    name: '1-modes',
    async go(p) {
      await p.goto(SITE, { waitUntil: 'load' });
      await settle(p, 2500);
    },
  },
  {
    name: '2-spin',
    async go(p) {
      await p.goto(SITE, { waitUntil: 'load' });
      await settle(p, 2500);
      await p.getByText('GM Mode', { exact: true }).first().click();
      await settle(p);
      // The button reads "SPIN THE WHEEL" on the first spin and "SPIN · n LEFT"
      // after. A looser /SPIN/i also matches the landing headline "Spin
      // history.", and then waits thirty seconds for a heading to be clickable.
      await p.getByText(/SPIN THE WHEEL|SPIN ·/i).first().click();
      await settle(p, 2600);
    },
  },
  {
    name: '3-scout',
    async go(p) {
      await p.goto(SITE, { waitUntil: 'load' });
      await settle(p, 2500);
      await p.getByText('Scout', { exact: true }).first().click();
      await settle(p);
      await p.getByText(/SPIN THE WHEEL|SPIN ·/i).first().click();
      await settle(p, 2600);
    },
  },
  {
    name: '4-rookie',
    async go(p) {
      await p.goto(SITE, { waitUntil: 'load' });
      await settle(p, 2500);
      await p.getByText('Rookie', { exact: true }).first().click();
      await settle(p);
      await p.getByText(/SPIN THE WHEEL|SPIN ·/i).first().click();
      await settle(p, 2600);
    },
  },
  {
    name: '5-leaderboard',
    async go(p) {
      await p.goto(SITE, { waitUntil: 'load' });
      await settle(p, 2500);
      await p.getByText('RANKS', { exact: false }).first().click();
      await settle(p, 2200);
    },
  },
];

// A scene that shows a roster part-built would be the best picture here, and it
// is deliberately absent. Taking a player needs a click on a card that
// react-native-web renders as an unlabelled div: matching it by text fails
// because the card reads "DEF2011 San Francisco Defen…SF201114.3 PPG42 SACK",
// clicking a fixed offset below the list header lands on a field slot and
// silently starts "filling RB1" instead, and clicking the rating does not reach
// the row's press handler at all. Worth another go behind a test id on the row.

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;

for (const [device, { w, h, scale }] of Object.entries(DEVICES)) {
  if (process.env.DEV && device !== process.env.DEV) continue;
  await mkdir(`${OUT}/${device}`, { recursive: true });

  for (const scene of SCENES) {
    if (process.env.ONLY && scene.name !== process.env.ONLY) continue;
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: scale,
      isMobile: device !== 'ipad-12.9',
      hasTouch: true,
      colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    try {
      await scene.go(page);
    } catch (cause) {
      // Shoot it anyway — seeing the wrong screen says more than an exception.
      console.log(`  ! ${device}/${scene.name}: ${String(cause).split('\n')[0].slice(0, 110)}`);
      failed++;
    }
    await page.screenshot({ path: `${OUT}/${device}/${scene.name}.png` });
    console.log(`  ${device}/${scene.name}.png  ${w * scale}x${h * scale}`);
    await ctx.close();
  }
}

await browser.close();
console.log(failed === 0 ? '\nAll scenes reached.\n' : `\n${failed} scene(s) did not reach their screen.\n`);
process.exit(failed === 0 ? 0 : 1);
