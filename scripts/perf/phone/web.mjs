/**
 * Measures the phone app's main-thread cost where a player feels it, in a
 * phone-sized Chromium with the CPU throttled, against a web export.
 *
 *   cd apps/mobile && EXPO_BASE_URL=/18-0 npx expo export -p web --output-dir ../../dist
 *   node scripts/perf/phone/web.mjs [dist] [--runs 5] [--cpu 4] [--history 300]
 *
 * The web build runs the same React tree as the phone -- the same screens,
 * stores, memo boundaries and derived data -- so a render storm or an
 * unmemoized walk over the history costs the same number of renders here as on
 * an iPhone, and is far cheaper to measure repeatably. What it cannot see is
 * native: Fabric commits, Svg rasterising on the main thread, the Hermes
 * bundle load. See `docs/performance.md` for how to read what it prints.
 *
 * For each step it reports the wall time from the tap to the screen being
 * ready, the main thread's busy time (CDP `TaskDuration`) over that step, and
 * the longest single task, which is the frame a player sees drop. Median of
 * `--runs`. Wall times that include a fixed animation (the reel is 1.27 s by
 * design) are reported for completeness; compare the busy time.
 *
 * `--history N` seeds N completed seasons before the run, because a player's
 * history is what the front page, the stats tab and the result screen walk,
 * and a fresh install hides every cost that grows with it.
 *
 * Nothing leaves the machine: every request that is not to the loopback
 * server is aborted, so a ranked season is never played and no flag resolves.
 */
import { chromium } from 'playwright';
// `--renders` and `--save-seed <file>` are described where they are read.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const root = resolve(import.meta.dirname, '../../..');
const dist = resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? join(root, 'dist'));
const RUNS = opt('runs', 5);
const CPU = opt('cpu', 4);
const HISTORY = opt('history', 300);
/**
 * `--renders` counts component renders per step instead of timing honestly:
 * the counting walks the tree on every commit, which costs main-thread time
 * of its own. Run it separately from the timed runs.
 */
const COUNT_RENDERS = args.includes('--renders');

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No web export at ${dist}.`);
  process.exit(2);
}
const BASE = /src="(\/[^"]*?)\/_expo\//.exec(readFileSync(join(dist, 'index.html'), 'utf8'))?.[1] ?? '';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let path = url.pathname;
  if (BASE && (path === BASE || path.startsWith(`${BASE}/`))) path = path.slice(BASE.length) || '/';
  const file = join(dist, path);
  const target = existsSync(file) && statSync(file).isFile() ? file : join(dist, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
  res.end(readFileSync(target));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const HOME = `${ORIGIN}${BASE}/`;

/**
 * A history of `n` seasons, cloned from one real season played by this
 * harness (so every field the screens read is the shape the app writes), with
 * each roster swapped for real cards of the same positions and the rating
 * varied, so the stats have something to aggregate.
 */
function seededHistory(template, n) {
  const dataset = JSON.parse(readFileSync(join(root, 'packages/data/generated/dataset.json'), 'utf8'));
  const byPosition = {};
  for (const card of dataset.cards) (byPosition[card.position] ??= []).push(card);
  const games = [];
  for (let i = 0; i < n; i++) {
    const entry = structuredClone(template);
    entry.id = `${1_700_000_000_000 + i}`;
    entry.completedAt = 1_700_000_000_000 + i * 3_600_000;
    entry.mode = i % 3 === 0 ? 'player_iq' : 'scout';
    entry.result.finalRating = 70 + (i % 25);
    entry.roster = entry.roster.map((pick, k) => {
      const pool = byPosition[pick.slot.replace(/\d/g, '')] ?? byPosition.QB;
      const card = pool[(i * 131 + k * 17) % pool.length];
      return { slot: pick.slot, cardId: card.id, name: card.name, franchiseId: card.franchiseId, era: card.era, year: card.year, rating: card.rating };
    });
    games.push(entry);
  }
  return JSON.stringify({ state: { games }, version: 0 });
}

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

async function oneRun(browser, history) {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: false, hasTouch: false,
  });
  await context.route('**/*', (route) =>
    route.request().url().startsWith(ORIGIN) ? route.continue() : route.abort());
  await context.addInitScript(({ history, countRenders }) => {
    try {
      // Before the bundle runs, so the persisted store hydrates from it. No
      // What's New, no onboarding: they are sheets over the screen measured.
      if (history && !localStorage.getItem('__perf_seeded')) {
        localStorage.setItem('18-0.history', history);
        localStorage.setItem('__perf_seeded', '1');
      }
    } catch {}
    /*
     * Component renders, counted from React's own devtools hook, which the
     * production build still calls on every commit. A fiber that rendered in
     * a commit carries PerformedWork (flag 1). Unlike time, this does not
     * move with the machine's load, so it is the number to compare first.
     */
    window.__renders = 0;
    window.__commits = 0;
    window.__byName = {};
    if (countRenders) {
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        renderers: new Map(),
        inject() { return 1; },
        onScheduleFiberRoot() {},
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        checkDCE() {},
        onCommitFiberRoot(_id, root) {
          window.__commits += 1;
          const stack = [root.current];
          while (stack.length) {
            const fiber = stack.pop();
            const before = fiber.alternate;
            // Function, forwardRef, memo and simple-memo components that ran:
            // new, or holding props or state they did not have last commit.
            if ((fiber.tag === 0 || fiber.tag === 11 || fiber.tag === 14 || fiber.tag === 15)
              && (!before || before.memoizedProps !== fiber.memoizedProps || before.memoizedState !== fiber.memoizedState)) {
              window.__renders += 1;
              const type = fiber.type?.type ?? fiber.type?.render ?? fiber.type;
              const name = fiber.type?.displayName || type?.displayName || type?.name || '?';
              window.__byName[name] = (window.__byName[name] ?? 0) + 1;
            }
            if (fiber.sibling) stack.push(fiber.sibling);
            // A subtree React bailed out of keeps its old children: nothing
            // under it rendered.
            if (fiber.child && !(before && before.child === fiber.child)) stack.push(fiber.child);
          }
        },
      };
    }
    window.__lt = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__lt.push({ start: e.startTime, d: e.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
  }, { history, countRenders: COUNT_RENDERS });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

  const busy = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    const counts = await page.evaluate(() => [window.__renders, window.__commits, { ...window.__byName }]);
    return {
      task: m.TaskDuration * 1000, script: m.ScriptDuration * 1000,
      layout: m.LayoutDuration * 1000 + m.RecalcStyleDuration * 1000,
      renders: counts[0], commits: counts[1], byName: counts[2],
    };
  };
  const now = () => page.evaluate(() => performance.now());
  const longest = (from) => page.evaluate((from) => Math.max(0, ...window.__lt.filter((e) => e.start >= from).map((e) => e.d)), from);
  const label = (l) => page.locator(`[aria-label="${l}"]`).first();
  const labelStarts = (l) => page.locator(`[aria-label^="${l}"]`).first();

  /** The next frame after whatever the last input set off has committed. */
  const painted = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
  const results = {};
  /**
   * `act` starts the step; `ready` resolves when the screen is usable. Busy
   * time is read after `settle` ms more, so work deferred past the first paint
   * (rows mounted a batch per frame, effects) is charged to the step.
   */
  const step = async (name, act, ready, settle = 600) => {
    const b0 = await busy();
    const t0 = await now();
    await act();
    await ready();
    const t1 = await now();
    await page.waitForTimeout(settle);
    const b1 = await busy();
    results[name] = {
      wall: t1 - t0,
      task: b1.task - b0.task,
      script: b1.script - b0.script,
      layout: b1.layout - b0.layout,
      longest: await longest(t0),
      renders: b1.renders - b0.renders,
      commits: b1.commits - b0.commits,
      top: Object.entries(b1.byName)
        .map(([k, v]) => [k, v - (b0.byName[k] ?? 0)])
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    };
  };

  // Cold start: navigation to the front page with its controls on it.
  {
    const b0 = await busy();
    await page.goto(HOME, { waitUntil: 'commit' });
    await label('Play for the leaderboard').waitFor({ timeout: 60_000 });
    const t1 = await now();
    await page.waitForTimeout(1500);
    const b1 = await busy();
    results.cold_start = {
      wall: t1, task: b1.task - b0.task, script: b1.script - b0.script, layout: b1.layout - b0.layout,
      longest: await longest(0), renders: b1.renders, commits: b1.commits,
    };
  }

  // Casual, so no server is asked.
  const sw = label('Play for the leaderboard');
  if ((await sw.getAttribute('aria-checked')) !== 'false') {
    await sw.click();
    await page.waitForTimeout(400);
  }

  // Tab switches, on the front page's own dock.
  for (const [tab, back] of [['Games', 'Play'], ['My Stats', 'Play'], ['Challenges', 'Play']]) {
    await step(`tab_${tab.replace(/\s/g, '_').toLowerCase()}`,
      () => page.locator(`[role="tab"][aria-label^="${tab}"], [aria-label="${tab}"]`).first().click(),
      painted, 900);
    await page.locator(`[role="tab"][aria-label^="${back}"], [aria-label="${back}"]`).first().click();
    await page.waitForTimeout(700);
  }

  // A one-tap start spins by itself, so the first spin is part of opening.
  await step('open_play_and_spin',
    () => labelStarts('Start a season in Scout').click(),
    () => page.locator('[aria-label="Search eligible players"]').waitFor({ timeout: 30_000 }), 1500);

  for (let pick = 1; pick <= 7; pick++) {
    if (pick > 1) await step(`spin_${pick}`,
      () => label('Spin the wheel').click(),
      () => page.locator('[aria-label="Search eligible players"]').waitFor({ timeout: 30_000 }),
      // Long enough for every row to have been mounted (a batch per frame).
      1500);
    // The first row that can still go somewhere: its label says so.
    const rows = page.locator('[role="button"][aria-label]');
    const handle = await rows.evaluateAll((els) => {
      const i = els.findIndex((e) => /\. (QB|RB|WR|TE|DEF)\. \d{4} /.test(e.getAttribute('aria-label') || '')
        && !/Already on your roster/.test(e.getAttribute('aria-label') || '')
        && e.getAttribute('aria-disabled') !== 'true');
      return i;
    });
    await step(`pick_${pick}`,
      async () => {
        await rows.nth(handle).click();
        const add = page.locator('[aria-label^="Add "]').first();
        if (await add.count()) await add.click();
      },
      () => page.locator('[aria-label="Search eligible players"]').waitFor({ state: 'detached', timeout: 30_000 }),
      600);
  }

  await step('reveal',
    () => label('Reveal your result').click(),
    () => label('Build another roster').waitFor({ timeout: 30_000 }), 1500);

  const stored = await page.evaluate(() => localStorage.getItem('18-0.history'));
  await context.close();
  return { results, stored };
}

// No WebGL: headless Chromium has no GPU, so the turf's shader is drawn in
// software and read back every frame -- most of the main thread, and nothing
// a phone pays. Without it the turf takes its fallback, as it does on any
// browser that cannot load CanvasKit, and what is left to measure is ours.
const browser = await chromium.launch({ headless: true, args: ['--disable-webgl', '--disable-3d-apis'] });
const runs = [];
try {
  // One unmeasured season on a fresh install, whose record becomes the
  // template for the seeded history.
  process.stderr.write('warm-up season\n');
  const warm = await oneRun(browser, null);
  const template = JSON.parse(warm.stored).state.games[0];
  const history = HISTORY > 0 ? seededHistory(template, HISTORY) : null;
  const save = args.indexOf('--save-seed');
  if (save >= 0 && history) writeFileSync(args[save + 1], history);
  for (let i = 0; i < RUNS; i++) {
    process.stderr.write(`run ${i + 1}/${RUNS}\n`);
    runs.push((await oneRun(browser, history)).results);
  }
} finally {
  await browser.close();
  server.close();
}

const names = Object.keys(runs[0]);
const rows = names.map((name) => {
  const pick = (k) => median(runs.map((r) => r[name]?.[k]));
  return {
    step: name, wall: pick('wall'), task: pick('task'), script: pick('script'), layout: pick('layout'),
    longest: pick('longest'), renders: pick('renders'), commits: pick('commits'),
  };
});
const agg = (prefix) => {
  const sel = rows.filter((r) => r.step.startsWith(prefix));
  const sum = (k) => sel.reduce((a, r) => a + r[k], 0);
  return {
    step: `${prefix}* (sum of ${sel.length})`, wall: sum('wall'), task: sum('task'), script: sum('script'),
    layout: sum('layout'), longest: Math.max(...sel.map((r) => r.longest)), renders: sum('renders'), commits: sum('commits'),
  };
};
rows.push(agg('spin_'), agg('pick_'), agg('tab_'));
const f = (n) => (Number.isFinite(n) ? n.toFixed(0).padStart(7) : '      -');
console.log(`\n${dist}\nCPU ${CPU}x, ${HISTORY} seasons of history, median of ${RUNS} runs (ms)\n`);
console.log('step                         wall    busy  script  layout longest renders commits');
for (const r of rows) {
  console.log(`${r.step.padEnd(26)}${f(r.wall)} ${f(r.task)} ${f(r.script)} ${f(r.layout)} ${f(r.longest)} ${f(r.renders)} ${f(r.commits)}`);
}
if (COUNT_RENDERS) {
  console.log('\nMost-rendered components per step (first run; names as the bundle keeps them):');
  for (const [name, r] of Object.entries(runs[0])) {
    if (r.top) console.log(`  ${name.padEnd(20)} ${r.top.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
}
if (args.includes('--json')) console.log(JSON.stringify({ cpu: CPU, history: HISTORY, runs }, null, 0));
