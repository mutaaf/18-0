#!/usr/bin/env node
// npm run clips: short-form vertical clips (TikTok, Shorts, Reels) of 17-0, cut from scripted seasons.
//
//   npm run clips                         export the web build, play every take, cut every clip in store/clips/clips.json
//   npm run clips -- --skip-capture       re-cut from the takes already in dist-clips/raw/ (caption or edit changes)
//   npm run clips -- --only=<id>          one clip (no contact sheet)
//   npm run clips -- --no-export          reuse dist/ as it is
//   npm run clips -- --search=1-40        play seasons headless for those seeds and print each one's record, no video
//
// A take is one season played in the exported web build with no network at all (every request off
// 127.0.0.1 is refused, so nothing can reach Supabase, a leaderboard or analytics). Math.random is replaced by a
// seeded generator before the app loads, so the wheel lands on the same seven franchise-eras every time, and the
// player takes the best player who fits an open slot on each spin (Rookie: the top of the list, which is in rating
// order; Gameday hides ratings, so the best stat line), saving the defence slot until the sixth spin. The record at the end is whatever the
// app's deterministic model says for those seven picks: nothing is staged.
//
// Two modes. Rookie (every rating on screen). Gameday: the browser clock is set to Thanksgiving, Thursday Nov 26 2026
// (Playwright's clock, so time still flows), and the season starts from the home screen's own Gameday marquee, so the
// wheel holds only that day's six franchises from the bundled schedule (packages/data/generated/schedule.json).
// Offline, the app plays it as an unranked gameday season, which is what a player with no connection would get.
//
// The app is the phone layout: a 432x768 frame, scaled 2.5x by a CSS transform on a 1080x1920 stage page, so
// recordVideo films it at 1080x1920 with crisp text (a 432x768 viewport would be filmed at 432x768 and padded).
// Output in dist-clips/ (gitignored); scripts/clips-lib.mjs does the cutting; store/clips/POSTING.md says what to post.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { main } from './clips-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.CLIPS_PORT) || 4861;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PHONE = { viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true };
const STAGE = { viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, hasTouch: true };
const STAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#06122e}
iframe{position:absolute;left:0;top:0;width:432px;height:768px;border:0;transform:scale(2.5);transform-origin:0 0}</style></head>
<body><iframe name="app" src="about:blank"></iframe></body></html>`;
const CAP = { QB: 1, RB: 2, WR: 2, TE: 1, DEF: 1 };
// 11:30 Eastern on Thanksgiving: the day's gameday window is open (it opens 15:00 UTC).
const THANKSGIVING = new Date('2026-11-26T16:30:00Z');

// The exported app, with the SPA fallback Vercel gives it (any unknown path is index.html).
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serve() {
  return http.createServer((req, res) => {
    if (req.url.startsWith('/__stage')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(STAGE_HTML); }
    let file = resolve(DIST, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403); return res.end(); }
    if (!existsSync(file) || statSync(file).isDirectory()) file = existsSync(join(file, 'index.html')) ? join(file, 'index.html') : join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  }).listen(PORT, '127.0.0.1');
}

// Runs in the page before the app: a seeded Math.random (mulberry32), and Rookie mode (the one that shows each
// player's rating, so a viewer can follow the picks) as the stored choice on a fresh profile.
const initScript = (seed) => `(() => {
  let a = ${seed} | 0;
  Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { if (!localStorage.getItem('18-0.game')) localStorage.setItem('18-0.game', JSON.stringify({ state: { mode: 'rookie', status: 'idle' }, version: 0 })); } catch {}
})();`;

const offline = (ctx) => ctx.route((u) => !u.href.startsWith(ORIGIN), (r) => r.abort());

// The list rows of the current spin: a position chip, a name, a full year (and, in Rookie, a rating).
const rowsJs = `[...document.querySelectorAll('[role=button],[tabindex="0"]')].filter((e) => { const r = e.getBoundingClientRect(), t = e.innerText || '';
  return /^(QB|RB|WR|TE|DEF)\\n/.test(t) && /\\n\\d{4}\\n/.test(t) && r.height > 40 && r.height < 200; })`;

/** Plays one season. mark() is clips-lib's (or a no-op when searching). Returns the picks and the record. */
async function season(page, mark = () => {}, { dwell = 900, settle = 5000, mode = 'rookie', marquee = 2600 } = {}) {
  const used = {}, picks = [];
  if (mode === 'gameday') {
    // In through the home screen's marquee, the way a player gets there on the day.
    await page.goto(`${ORIGIN}/`);
    const enter = page.getByText(/^(Enter Gameday|Play before the whistle|Take today.s \d+ teams)$/i).first();
    await enter.waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const e = [...document.querySelectorAll('*')].find((n) => /^GAMEDAY\s*·\s*LIVE NOW$/i.test((n.innerText || '').trim()));
      (e || document.body).scrollIntoView({ block: 'start' });
      // A little headroom above the marquee, in whichever scroller holds it.
      let p = e && e.parentElement;
      while (p && !(p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
      (p || document.scrollingElement).scrollTop -= 64; });
    await page.waitForTimeout(900);
    mark('marquee');
    await page.waitForTimeout(marquee);
    await enter.click();
    mark('enter');
  } else {
    await page.goto(`${ORIGIN}/play`);
  }
  const spinButton = page.getByText(/^SPIN( THE WHEEL| · \d+ LEFT)$/i).first();
  await spinButton.waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  mark('ready');
  for (let k = 0; k < 7; k++) {
    await spinButton.click();
    mark(`spin${k}`);
    // The reel has landed when the list of this spin's players is up.
    await page.waitForFunction(`${rowsJs}.length > 0 && !/Spinning/.test(document.body.innerText)`, null, { timeout: 30000, polling: 50 });
    mark(`landed${k}`);
    await page.waitForTimeout(dwell);
    const pick = await page.evaluate(({ js, cap, used, k, mode }) => {
      // The best player who fits an open slot (Rookie: the first listed, the list is in rating order), keeping the one defence slot for late in the season (a
      // spin's list usually opens with its defence, and taking it first leaves skill slots nobody can fill).
      const fits = eval(js).filter((e) => { const pos = e.innerText.split('\n')[0].trim(); return (used[pos] || 0) < cap[pos]; });
      // Gameday hides ratings, so there the player reads the stat lines the way a person would: yards against a big
      // season at the position, a touchdown worth 20 yards, an interception 30; a defence by points allowed.
      const num = (t, unit) => { const m = t.match(new RegExp('([\\d,.]+)\\s*' + unit + '\\b')); return m ? Number(m[1].replace(/,/g, '')) : 0; };
      const BIG = { QB: 4200, RB: 1500, WR: 1300, TE: 950 };
      const score = (e) => { const t = e.innerText.replace(/\n/g, ' '), pos = t.split(' ')[0];
        if (pos === 'DEF') return 20 / Math.max(10, num(t, 'PPG') || 30);
        return (num(t, 'YDS') + 20 * num(t, 'TD') - 30 * num(t, 'INT')) / BIG[pos]; };
      const ranked = mode === 'gameday' ? [...fits].sort((a, b) => score(b) - score(a)) : fits;
      const row = k >= 5 ? ranked[0] : (ranked.find((e) => !/^DEF\n/.test(e.innerText)) || ranked[0]);
      if (!row) return null;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      window.__pickRow = row;
      return { pos: row.innerText.split('\n')[0].trim(), text: row.innerText.split('\n').slice(1).join(' ') };
    }, { js: rowsJs, cap: CAP, used, k, mode });
    if (!pick) throw new Error(`spin ${k}: no player fits an open slot`);
    await page.waitForTimeout(700);   // the scroll settles; measure where the row is now
    const row = await page.evaluateHandle(() => window.__pickRow);
    const box = await page.evaluate(() => { const r = window.__pickRow.getBoundingClientRect(); return { x: r.width * 0.4, y: r.height / 2 }; });
    await row.click({ position: box });
    mark(`pick${k}`);
    used[pick.pos] = (used[pick.pos] || 0) + 1;
    picks.push(`${pick.pos} ${pick.text}`);
    if (CAP[pick.pos] === 2) {
      // Two open slots for the position: the app asks which. The chooser's buttons come after the field's slots.
      await page.waitForTimeout(500);
      const slot = page.getByText(new RegExp(`^${pick.pos}[12]$`));
      if (await slot.count() > 2) { await page.waitForTimeout(300); await slot.last().click(); }
    }
    if (k < 6) await spinButton.waitFor({ timeout: 20000 });
  }
  const reveal = page.getByText('REVEAL RESULT');
  await reveal.waitFor({ timeout: 20000 });
  await page.waitForTimeout(1400);
  mark('complete');
  await reveal.click();
  mark('reveal');
  await page.getByText(/PROJECTED RECORD/i).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(settle);
  mark('end');
  const body = await page.innerText('body');
  const i = body.search(/PROJECTED RECORD/i);
  // The record is drawn twice (a glow under the digits), so its text reads "13 13 4 4".
  const record = ((body.slice(i).match(/PROJECTED RECORD\s+(\d+)\s+\d+\s+(\d+)/i)) || []).slice(1, 3).join('-');
  return { picks, record, verdict: body.slice(i, i + 80).replace(/\s+/g, ' ') };
}

function take(name, seed, mode = 'rookie') {
  return {
    name,
    context: STAGE,
    init: undefined,
    drive: async (page, mark) => {
      await offline(page.context());
      if (mode === 'gameday') await page.context().clock.install({ time: THANKSGIVING });
      await page.context().addInitScript({ content: initScript(seed) });
      await page.goto(`${ORIGIN}/__stage`);
      const r = await season(page.frame('app'), mark, { mode });
      console.log(`    ${name}: seed ${seed}: ${r.record} ${r.verdict}\n      ${r.picks.join('\n      ')}`);
    },
  };
}

// --search=a-b: which seeds give which seasons (no video), to choose takes.
const search = process.argv.find((a) => a.startsWith('--search='));
const MODE = process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1] || 'rookie';
if (search) {
  const [a, b] = search.split('=')[1].split('-').map(Number);
  const server = serve();
  const browser = await chromium.launch();
  try {
    for (let s = a; s <= (b || a); s++) {
      const ctx = await browser.newContext(PHONE);
      await offline(ctx);
      if (MODE === 'gameday') await ctx.clock.install({ time: THANKSGIVING });
      await ctx.addInitScript({ content: initScript(s) });
      const page = await ctx.newPage();
      try { const r = await season(page, undefined, { dwell: 0, settle: 2500, mode: MODE, marquee: 0 }); console.log(`seed ${s}: ${r.record} [${r.verdict}] | ${r.picks.map((p) => p.split(' ').slice(0, 3).join(' ')).join(', ')}`); }
      catch (e) { console.log(`seed ${s}: failed ${e.stack.split('\n').slice(0,4).join(' ')}`); await page.screenshot({ path: join(ROOT, 'dist-clips', `fail-${s}.png`) }).catch(() => {}); }
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  process.exit(0);
}

// The seasons the clips are cut from (store/clips/clips.json names them). Chosen with --search.
const TAKES = [
  take('gameday-a', 8, 'gameday'),   // Thanksgiving Gameday: 16-1 (Heartbreak)
  take('gameday-b', 15, 'gameday'),  // Thanksgiving Gameday: 13-4 (Elite)
  take('rookie', 1),                 // Rookie, ratings on screen: 13-4 (Elite)
];

let server;
await main({
  chromium,
  root: ROOT,
  title: '17-0: short-form clips',
  takes: TAKES,
  before: async () => {
    if (process.argv.includes('--skip-capture')) return {};
    if (!process.argv.includes('--no-export') || !existsSync(join(DIST, 'index.html'))) {
      console.log('exporting the web build to dist/');
      execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', '../../dist'], { cwd: join(ROOT, 'apps/mobile'), stdio: 'inherit' });
    }
    server = serve();
    return {};
  },
  after: async () => { server?.close(); },
});
