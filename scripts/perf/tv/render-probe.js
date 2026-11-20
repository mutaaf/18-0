/*
 * The JS thread's share of a remote press, measured inside the app.
 *
 * An entry file, used only by js-probe.sh, which bundles the app with this
 * in front of expo-router's own entry and swaps the bundle into the installed
 * simulator build for one harness run. Never shipped: the app's entry is
 * untouched.
 *
 * - **Renders and commits per press**, from React's devtools hook, which the
 *   production renderer calls on every commit when one is installed before it
 *   loads (hence an entry file). A component that rendered in a commit holds
 *   props or state it did not have in the last one; a subtree React bailed
 *   out of keeps its old children and is not walked. Counts, not time, so
 *   they do not move with the Mac's load -- the number to compare first.
 * - **How late a 0 ms timer set at the press fires**, which is what
 *   `tv_jank`'s `js_median_ms` reports from real Apple TVs (features/tv/jank.ts).
 *   On the simulator it is mostly the one frame a timer waits for anyway.
 *
 * - **When each commit landed**, for a press that rendered a lot (a reveal, a
 *   navigation): `commits_at=<ms after the press>:<renders>,...`, so a screen
 *   whose first commit is late can be told from one that commits early and
 *   then keeps committing.
 * - **The app's own `screen_ready`** (features/diagnostics/screen.ts), read
 *   from telemetry's ring and posted as `[perf] screen <route> first=<ms>
 *   settled=<ms>` -- the same number real Apple TVs report to PostHog.
 *
 * Neither sees a commit React did not make: a scroll view's state update is
 * one too, and only Time Profiler (js-probe.sh's PROFILE) shows those.
 *
 * One line per press is posted to js-probe.sh's listener on the Mac
 * (127.0.0.1:8787; the app allows local networking), in batches, so the
 * reporting never lands inside a press it is measuring. A Release build logs
 * `console.log` nowhere a harness can read.
 */
/* eslint-disable */
const perf = { renders: 0, commits: 0, byName: {} };
global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  supportsFiber: true,
  renderers: new Map(),
  inject() {
    return 1;
  },
  onScheduleFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  checkDCE() {},
  onCommitFiberRoot(_id, root) {
    perf.commits += 1;
    const rendersBefore = perf.renders;
    const mine = {};
    const stack = [root.current];
    while (stack.length) {
      const fiber = stack.pop();
      const before = fiber.alternate;
      // Function, class, forwardRef, memo and simple-memo components.
      if (
        (fiber.tag === 0 || fiber.tag === 1 || fiber.tag === 11 || fiber.tag === 14 || fiber.tag === 15) &&
        (!before || before.memoizedProps !== fiber.memoizedProps || before.memoizedState !== fiber.memoizedState)
      ) {
        perf.renders += 1;
        const type = (fiber.type && (fiber.type.type || fiber.type.render)) || fiber.type;
        const name = (fiber.type && fiber.type.displayName) || (type && (type.displayName || type.name)) || '?';
        perf.byName[name] = (perf.byName[name] || 0) + 1;
        mine[name] = (mine[name] || 0) + 1;
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child && !(before && before.child === fiber.child)) stack.push(fiber.child);
    }
    {
      // The commit's own most-rendered components, skipping the host views
      // every commit is mostly made of, so it can be told what it was.
      const named = Object.entries(mine)
        .filter(([n]) => !/^(View|Text|Pressable|TVPressable|Animated|AnimatedComponent|\?)/.test(n))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([n, c]) => `${n}/${c}`)
        .join('+');
      if (last) last.at.push(`${Date.now() - last.t0}:${perf.renders - rendersBefore}${named ? `[${named}]` : ''}`);
      // A large commit outside any press's window: work a screen deferred
      // (the result page under the broadcast record, at the record's hold).
      else if (perf.renders - rendersBefore >= 100 && lastPress)
        send(`[perf] commit late +${Date.now() - lastPress}ms renders=${perf.renders - rendersBefore} [${named}]`);
    }
  },
};

const PRESSES = new Set(['up', 'down', 'left', 'right', 'select', 'longSelect', 'playPause', 'menu']);
let buffer = [];
let sendTimer = null;
function send(line) {
  buffer.push(line);
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = setTimeout(
    () => {
      sendTimer = null;
      const body = buffer.join('\n');
      buffer = [];
      fetch('http://127.0.0.1:8787/', { method: 'POST', body }).catch(() => {});
    },
    buffer.length >= 16 ? 250 : 2500,
  );
}

let last = null;
let lastPress = 0;
function flush() {
  if (!last) return;
  const names = Object.entries(perf.byName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([n, c]) => `${n}:${c}`)
    .join(',');
  const renders = perf.renders - last.r;
  const at = renders >= 100 ? ` commits_at=${last.at.join(',')}` : '';
  send(`[perf] press ${last.type} late=${last.late} renders=${renders} commits=${perf.commits - last.c} top=${names}${at}`);
  last = null;
}

setTimeout(() => {
  require('react-native').TVEventHandler.addListener((event) => {
    if (!PRESSES.has(event.eventType) || event.eventKeyAction === 0) return;
    // A press's renders are everything up to the next press (or 1.5 s).
    flush();
    perf.byName = {};
    const at = Date.now();
    lastPress = at;
    const entry = { type: event.eventType, late: -1, r: perf.renders, c: perf.commits, t0: at, at: [] };
    last = entry;
    setTimeout(() => {
      entry.late = Date.now() - at;
    }, 0);
    setTimeout(() => {
      if (last === entry) flush();
    }, 1500);
  });
  // The app's own screen timing, as PostHog would get it.
  const telemetry = require('../../../apps/mobile/src/features/telemetry');
  let seen = 0;
  setInterval(() => {
    for (const e of telemetry.recentEvents()) {
      if (e.name !== 'screen_ready' || e.at <= seen) continue;
      seen = e.at;
      const p = e.props;
      send(`[perf] screen ${p.route} from=${p.from} basis=${p.basis} first=${p.first_frame_ms} settled=${p.settled_ms} idle=${p.idle}`);
    }
  }, 1000);
}, 3000);

require('expo-router/entry');
