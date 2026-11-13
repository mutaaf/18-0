#!/usr/bin/env node
/**
 * The iPhone Duo's open poses, captured from the web build at the Duo's own
 * geometry, for the front page's showcase.
 *
 *   node scripts/store/capture-duo-web.mjs [url] [outdir]
 *
 * Why the web and not the simulator: the iPhone Duo simulator cannot move its
 * hinge (Cold Gas and Moon Club both found this), so it shows one pose. The web
 * runs the same SpreadLayout, and `features/fold/web.ts` reads the fold from
 * `window.viewport.segments`, which is injected here with the simulator's
 * numbers before the app boots:
 *
 *   book      951 x 669, fold band x 455.5-495.5 (docs/iphone-duo.md)
 *   tabletop  the same display turned portrait: 669 x 951, band y 455.5-495.5
 *
 * Headless Chrome clamps a *window* to 500 wide, so the size comes from
 * Emulation.setDeviceMetricsOverride rather than --window-size.
 *
 * Plays a casual game only ("Play for the leaderboard" off): nothing it does
 * reaches a board. Each pose gets a fresh profile, so nothing carries over.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const URL_ = process.argv[2] ?? 'https://18-0.co/?nowhatsnew&capture';
const OUT = resolve(process.argv[3] ?? 'apps/mobile/public/showcase/raw');
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(existsSync);
if (!CHROME) throw new Error('needs Chrome');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAND = [455.5, 495.5];
const POSES = {
  book: { width: 951, height: 669, segments: [[0, 0, BAND[0], 669], [BAND[1], 0, 951 - BAND[1], 669]] },
  tabletop: { width: 669, height: 951, segments: [[0, 0, 669, BAND[0]], [0, BAND[1], 669, 951 - BAND[1]]] },
};

async function session(pose) {
  const profile = mkdtempSync(join(tmpdir(), 'duo-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
    await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const { width, height, segments } = POSES[pose];
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const segs = JSON.stringify(segments);
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { const s = ${segs}.map(([x, y, w, h]) => new DOMRectReadOnly(x, y, w, h));
      Object.defineProperty(window, 'viewport', { value: { segments: s }, configurable: true });
      Object.defineProperty(navigator, 'devicePosture', { value: Object.assign(new EventTarget(), { type: 'continuous' }), configurable: true }); })();`,
  });
  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const close = () => { ws.close(); proc.kill(); rmSync(profile, { recursive: true, force: true }); };
  return { send, evaluate, close };
}

/** The centre of the first visible element whose aria-label (or, failing that, text) matches. */
const FIND = (re, index = 0) => `(() => {
  const re = new RegExp(${JSON.stringify(re)});
  const all = [...document.querySelectorAll('[aria-label],[role=button],[role=switch],[role=checkbox]')]
    .filter((el) => re.test(el.getAttribute('aria-label') ?? '') || (!el.getAttribute('aria-label') && re.test(el.textContent ?? '')));
  const el = all[${index}];
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
})()`;

async function waitFor(s, re, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const hit = await s.evaluate(`(() => { const re = new RegExp(${JSON.stringify(re)}); return [...document.querySelectorAll('[aria-label]')].some((e) => re.test(e.getAttribute('aria-label'))) || re.test(document.body.innerText); })()`);
    if (hit) return;
    await sleep(300);
  }
  throw new Error(`never saw ${re}`);
}

async function tap(s, re, index = 0) {
  let at = null;
  for (let i = 0; i < 60 && !at; i++) { at = await s.evaluate(FIND(re, index)); if (!at) await sleep(300); }
  if (!at) throw new Error(`nothing to tap: ${re}`);
  await sleep(250); // let scrollIntoView finish
  at = (await s.evaluate(FIND(re, index))) ?? at;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await s.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  }
  await sleep(500);
}

async function shot(s, name) {
  await s.evaluate('window.scrollTo(0, 0); document.querySelectorAll("*").forEach((e) => { if (e.scrollTop) e.scrollTop = 0; }); 1');
  await sleep(1200);
  const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  ${name}.png`);
}

async function pick(s) {
  await tap(s, '^Spin the wheel');
  await waitFor(s, 'Tap a position');
  await sleep(1200);
  await tap(s, ' slot\\. Empty\\.');
  await tap(s, '\\. (QB|RB|WR|TE|DEF)\\. \\d{4} .*Rating ');
  await sleep(600);
}

async function play(pose, picks) {
  const s = await session(pose);
  try {
    await s.send('Page.navigate', { url: URL_ });
    await waitFor(s, 'Pick your lens', 90000);
    await sleep(2500);
    await shot(s, `${pose}-home`);
    await tap(s, '^Play for the leaderboard');
    await tap(s, '^Play Rookie');
    for (let i = 0; i < picks; i++) await pick(s);
    // One more spin, landed but not picked: the list is full and the hero shows the team and era.
    await tap(s, '^Spin the wheel');
    await waitFor(s, 'Tap a position');
    await sleep(1800);
    await shot(s, `${pose}-play`);
  } finally {
    s.close();
  }
}

for (const pose of Object.keys(POSES)) {
  console.log(pose);
  await play(pose, 4);
}
