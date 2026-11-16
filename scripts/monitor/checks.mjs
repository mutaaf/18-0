#!/usr/bin/env node
/**
 * Is 17-0 up, for a player, right now?
 *
 *   node scripts/monitor/checks.mjs              # every check, a table, exit 1 on failure
 *   node scripts/monitor/checks.mjs --json out   # the same, also written as JSON for incident.mjs
 *   node scripts/monitor/checks.mjs --only site,server
 *
 * Run every fifteen minutes by `.github/workflows/monitor.yml`, which hands
 * the JSON to `incident.mjs` to open, update or close one `incident` issue.
 * Runs anywhere Node 22 and Chrome are: the same command on a laptop is the
 * first step of every runbook in docs/observability.md.
 *
 * ---------------------------------------------------------------------------
 * What it will never do
 * ---------------------------------------------------------------------------
 *
 * **Play a ranked game, or write anything to production.** Two harnesses
 * playing real games against one database at the same moment once looked
 * exactly like a regression and was chased as one (CLAUDE.md). So the browser
 * check blocks Supabase outright -- the game must play offline anyway, which
 * makes that a check of invariant 3 rather than a limitation -- and it refuses
 * to start a season unless the ranked switch reads off. The server checks are
 * reads: a health endpoint, a preflight, a refused unauthenticated call, and
 * one row of a public leaderboard.
 *
 * **Count as a player.** PostHog, Box Office and every ad host are blocked in
 * the browser, so a synthetic visit is not a session in the funnels, not a
 * page view in the portfolio, and not an ad impression -- the last of which
 * would be invalid traffic on somebody else's ad network, not just noise.
 *
 * ---------------------------------------------------------------------------
 * Flakes
 * ---------------------------------------------------------------------------
 *
 * Every check that fails is tried once more after a pause before it counts.
 * A monitor that opens an incident for one dropped packet is a monitor whose
 * incidents get ignored, and then it is not a monitor.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SITE = (process.env.MONITOR_SITE ?? 'https://18-0.co').replace(/\/+$/, '');
const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const REPO = process.env.GITHUB_REPOSITORY ?? 'mutaaf/18-0';
const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const RETRY_MS = Number(process.env.MONITOR_RETRY_MS ?? 45_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fetch that cannot hang the run. */
async function get(url, init = {}, ms = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
    const text = await res.text();
    return { status: res.status, text, ms: Date.now() - started, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// The checks. Each returns { ok, detail } or throws; a throw is a failure.
// ---------------------------------------------------------------------------

const CHECKS = [];
const check = (group, name, run) => CHECKS.push({ group, name, run });

check('site', 'home page serves the app', async () => {
  const r = await get(`${SITE}/`);
  const shell = /<div id="root"|_expo\/static\/js/.test(r.text);
  return { ok: r.status === 200 && shell, detail: `${r.status} in ${r.ms}ms${shell ? '' : ', no app shell in the HTML'}` };
});

check('site', 'privacy policy serves', async () => {
  const r = await get(`${SITE}/privacy`);
  // The text itself, not just a 200: this is the address the stores and the
  // OAuth consent screen hold, and it once served a page with no policy in it.
  const ok = r.status === 200 && /Privacy Policy/.test(r.text) && /PostHog/.test(r.text);
  return { ok, detail: `${r.status} in ${r.ms}ms` };
});

check('site', 'ledger serves', async () => {
  const r = await get(`${SITE}/ledger`);
  return { ok: r.status === 200 && r.text.length > 1000, detail: `${r.status}, ${r.text.length} bytes in ${r.ms}ms` };
});

check('site', 'stat-lines manifest serves', async () => {
  const r = await get(`${SITE}/stat-lines-manifest.json`);
  let parsed = false;
  try {
    parsed = Boolean(JSON.parse(r.text));
  } catch {}
  return { ok: r.status === 200 && parsed, detail: `${r.status} in ${r.ms}ms` };
});

check('browser', 'boots and plays a casual season offline', async () => playInChrome());

check('server', 'health endpoint', async () => {
  if (!SUPABASE_URL) return { ok: false, detail: 'SUPABASE_URL is not set' };
  const r = await get(`${SUPABASE_URL}/functions/v1/health`, { headers: { 'x-client': 'monitor' } });
  // Not deployed yet is said plainly rather than treated as an outage: the
  // function ships in the repository before it ships to the project, and an
  // incident for a deploy nobody has run would be an incident nobody can fix.
  if (r.status === 404) return { ok: true, warn: true, detail: 'not deployed (supabase functions deploy health)' };
  let body = null;
  try {
    body = JSON.parse(r.text);
  } catch {}
  const db = body?.checks?.database;
  const scoring = body?.checks?.scoring;
  const detail = body
    ? `${r.status}; db ${db?.ok ? 'ok' : 'FAIL'} ${db?.ms ?? '?'}ms, ${db?.cards ?? '?'} cards; scoring ${scoring?.version ?? '?'}`
    : `${r.status}, not JSON`;
  return { ok: r.status === 200 && body?.ok === true, warn: Boolean(db?.slow), detail };
});

for (const fn of ['spin', 'select', 'complete-game', 'delete-account']) {
  check('server', `${fn} is deployed and refuses a stranger`, async () => {
    if (!SUPABASE_URL || !ANON_KEY) return { ok: false, detail: 'SUPABASE_URL / SUPABASE_ANON_KEY not set' };
    // The preflight boots the function and runs our code; the POST with only
    // the public key proves it reaches Auth and refuses, writing nothing --
    // every function checks the caller before it reads a body or a row.
    const pre = await get(`${SUPABASE_URL}/functions/v1/${fn}`, { method: 'OPTIONS', headers: { origin: SITE } });
    const post = await get(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}`, 'content-type': 'application/json', 'x-client': 'monitor' },
      body: '{}',
    });
    const refused = post.status === 401 && /unauthenticated/.test(post.text);
    return {
      ok: pre.status === 200 && refused,
      detail: `preflight ${pre.status}, stranger ${post.status} in ${post.ms}ms${refused ? '' : ` (${post.text.slice(0, 80)})`}`,
    };
  });
}

check('server', 'auth answers', async () => {
  if (!SUPABASE_URL || !ANON_KEY) return { ok: false, detail: 'SUPABASE_URL / SUPABASE_ANON_KEY not set' };
  const r = await get(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON_KEY } });
  return { ok: r.status === 200, detail: `${r.status} in ${r.ms}ms` };
});

check('server', 'a leaderboard reads', async () => {
  if (!SUPABASE_URL || !ANON_KEY) return { ok: false, detail: 'SUPABASE_URL / SUPABASE_ANON_KEY not set' };
  const r = await get(`${SUPABASE_URL}/rest/v1/leaderboard_rating?select=*&limit=1`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` },
  });
  let rows = null;
  try {
    rows = JSON.parse(r.text);
  } catch {}
  return { ok: r.status === 200 && Array.isArray(rows), detail: `${r.status} in ${r.ms}ms` };
});

/** The newest completed runs of a workflow, via the gh CLI the runner already has. */
async function runs(workflow, extra = []) {
  const out = await new Promise((resolve, reject) => {
    const p = spawn('gh', ['run', 'list', '--repo', REPO, '--workflow', workflow, '--limit', '10',
      '--json', 'conclusion,status,event,createdAt,url,headBranch', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    let err = '';
    p.stdout.on('data', (d) => (text += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(err.trim() || `gh exited ${code}`))));
  });
  return JSON.parse(out).filter((r) => r.status === 'completed' && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped');
}

check('builds', 'TestFlight schedule is not failing', async () => {
  // Two in a row, not one: Apple's upload endpoint has bad hours, and the
  // schedule runs three times a day, so one red run is a retry away from
  // green. Two is a schedule that is broken until somebody looks.
  const scheduled = (await runs('ios-github.yml', ['--event', 'schedule'])).slice(0, 2);
  if (scheduled.length === 0) return { ok: true, warn: true, detail: 'no completed scheduled runs yet' };
  const failing = scheduled.filter((r) => r.conclusion !== 'success');
  return {
    ok: failing.length < 2,
    warn: failing.length === 1,
    detail: `last ${scheduled.length}: ${scheduled.map((r) => r.conclusion).join(', ')} (${scheduled[0].url})`,
  };
});

check('builds', 'CI on main is green', async () => {
  const latest = (await runs('ci.yml', ['--branch', 'main']))[0];
  if (!latest) return { ok: true, warn: true, detail: 'no completed runs on main' };
  return { ok: latest.conclusion === 'success', detail: `${latest.conclusion} (${latest.url})` };
});

// ---------------------------------------------------------------------------
// The browser check
// ---------------------------------------------------------------------------

/**
 * Hosts a synthetic visit must not reach. Analytics and ads so it is not
 * counted as a player; Supabase so it cannot write anything at all, and so the
 * season it plays proves the offline promise rather than assuming it.
 */
const BLOCKED = [
  '*posthog.com*',
  '*mutaafaziz.com*',
  '*googlesyndication.com*',
  '*doubleclick.net*',
  '*googleadservices.com*',
  '*google-analytics.com*',
  '*googletagmanager.com*',
  '*adtrafficquality.google*',
  '*supabase.co*',
  '*supabase.in*',
];

async function playInChrome() {
  const chrome = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((p) => p && existsSync(p));
  if (!chrome) return { ok: false, detail: 'no Chrome on this machine (set CHROME_PATH)' };

  const profile = mkdtempSync(join(tmpdir(), 'monitor-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  // SwiftShader rather than --disable-gpu: with no WebGL at all, CanvasKit
  // throws "failed to create webgl context" as an uncaught string on every GPU
  // surface (docs/graphics.md), which is a real thing for a real browser with
  // WebGL off, and not the thing this check is here to find.
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const errors = [];
  const started = Date.now();
  let ws;
  try {
    let targets = [];
    for (let i = 0; i < 100 && !targets.length; i++) {
      try {
        targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page');
      } catch {}
      if (!targets.length) await sleep(200);
    }
    if (!targets.length) return { ok: false, detail: 'Chrome never opened a debugging port' };
    ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.addEventListener('open', r, { once: true });
      ws.addEventListener('error', j, { once: true });
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        const what = d.exception?.description?.split('\n')[0] ?? JSON.stringify(d.exception?.value ?? d.text);
        errors.push(`${what} at ${d.url ?? '?'}:${d.lineNumber ?? '?'}`);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    const evaluate = async (expression) =>
      (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

    await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: BLOCKED });
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
    await send('Page.enable');
    // `?capture` keeps the What's New sheet out of the way and records nothing.
    await send('Page.navigate', { url: `${SITE}/?capture&nowhatsnew` });

    const result = await evaluate(`(${inPage.toString()})()`);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (!result.ok) return { ok: false, detail: `${result.error} after ${seconds}s${errors.length ? `; ${errors[0]}` : ''}` };
    if (errors.length) return { ok: false, detail: `played, but ${errors.length} uncaught error(s): ${errors.join(' | ')}` };
    return { ok: true, detail: `home in ${result.homeMs}ms, a full casual season in ${seconds}s` };
  } finally {
    try {
      ws?.close();
    } catch {}
    proc.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

/**
 * Runs inside the page. Drives the game the way the fold harness does: by
 * accessible names, with React Native Web's pointer events dispatched by hand.
 */
function inPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now();
  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const labelled = (test) => all('[role="button"],[role="switch"],[aria-label]').filter((e) => test(e.getAttribute('aria-label') || ''));
  const poll = async (fn, ms = 30000) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const got = fn();
      if (got) return got;
      await sleep(150);
    }
    return null;
  };
  const click = (el) => {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
  };
  const broken = () => /This screen hit a bug/.test(document.body.innerText);
  const fail = (error) => ({ ok: false, error: broken() ? `${error}; the recovery screen is showing` : error });

  return (async () => {
    const sw = await poll(() => labelled((l) => l === 'Play for the leaderboard')[0], 60000);
    if (!sw) return fail('the home screen never showed the ranked switch');
    const homeMs = Math.round(performance.now() - t0);
    // Off, and proved off, before anything is started -- see the header.
    if (sw.getAttribute('aria-checked') !== 'false') {
      click(sw);
      await sleep(600);
    }
    if (sw.getAttribute('aria-checked') !== 'false') return fail(`the ranked switch reads ${sw.getAttribute('aria-checked')}, refusing to play`);

    const rookie = await poll(() => labelled((l) => l.indexOf('Play Rookie') === 0)[0]);
    if (!rookie) return fail('no Rookie card');
    click(rookie);

    for (let pick = 0; pick < 7; pick++) {
      const spin = await poll(() => labelled((l) => l === 'Spin the wheel')[0]);
      if (!spin) return fail(`no Spin button before pick ${pick + 1}`);
      click(spin);
      const landed = await poll(() => (labelled((l) => / slot\. Empty\./.test(l)).length ? true : null));
      if (!landed) return fail(`spin ${pick + 1} never landed`);
      await sleep(1600);
      const before = labelled((l) => / slot\. Empty\./.test(l)).length;
      let placed = false;
      for (const slot of labelled((l) => / slot\. Empty\./.test(l))) {
        click(slot);
        await sleep(500);
        const row = labelled((l) => /\. (QB|RB|WR|TE|DEF)\. \d{4} /.test(l))[0];
        if (!row) continue;
        click(row);
        await sleep(500);
        const add = labelled((l) => l.indexOf('Add ') === 0)[0];
        if (add) {
          click(add);
          await sleep(500);
        }
        if (labelled((l) => / slot\. Empty\./.test(l)).length < before) {
          placed = true;
          break;
        }
      }
      // The wheel only lands on a franchise-era with somebody for an open
      // slot, so a spin nobody could be picked from is the game failing, not
      // bad luck.
      if (!placed) return fail(broken() ? `the play screen broke on pick ${pick + 1}` : `could not place a player from spin ${pick + 1}`);
    }

    const reveal = await poll(() => labelled((l) => l === 'Reveal your result')[0], 15000);
    if (reveal) click(reveal);
    const done = await poll(() => labelled((l) => l === 'Build another roster')[0], 30000);
    if (!done) return fail('the result screen never appeared');
    return { ok: true, homeMs };
  })();
}

// ---------------------------------------------------------------------------

async function attempt(c) {
  try {
    return await c.run();
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

const results = [];
for (const c of CHECKS) {
  if (only && !only.has(c.group)) continue;
  let outcome = await attempt(c);
  if (!outcome.ok) {
    await sleep(RETRY_MS);
    const second = await attempt(c);
    outcome = second.ok ? { ...second, warn: true, detail: `${second.detail} (passed on retry; first: ${outcome.detail})` } : second;
  }
  results.push({ group: c.group, name: c.name, ...outcome });
  console.log(`${outcome.ok ? (outcome.warn ? 'WARN' : ' ok ') : 'FAIL'}  ${c.group.padEnd(8)} ${c.name.padEnd(48)} ${outcome.detail ?? ''}`);
}

const failing = results.filter((r) => !r.ok);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), site: SITE, results }, null, 2));
console.log(failing.length ? `\n${failing.length} failing.` : '\nAll clear.');
process.exit(failing.length ? 1 : 0);
