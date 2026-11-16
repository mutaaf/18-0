import { flushAnalytics } from '@/features/analytics';
import { reportHealth } from './report';
import { clsFromShifts, inpFromEvents, rate } from './vitals-math';

/**
 * LCP, CLS and INP for the web build, as one `web_vitals` event per page load.
 *
 * Measured with the browser's own PerformanceObserver (the arithmetic is in
 * `vitals-math.ts`), and sent when the page is hidden, because that is the
 * first moment all three are final: LCP stops at the first input, but CLS and
 * INP keep counting for as long as the page is open.
 *
 * Sent and then flushed straight away. The analytics module flushes on the
 * same `visibilitychange`, so without a second flush of its own this event sat
 * in a queue that had just been emptied, on a page about to be thrown away.
 *
 * Safari has no LCP, CLS or INP at all, so on an iPhone browser this reports
 * TTFB and FCP only. That is the browser, not a bug.
 */

type Entry = PerformanceEntry & {
  value?: number;
  hadRecentInput?: boolean;
  interactionId?: number;
  renderTime?: number;
  loadTime?: number;
};

let started = false;

function observe(type: string, onEntries: (entries: Entry[]) => void, extra: Record<string, unknown> = {}): void {
  try {
    const observer = new PerformanceObserver((list) => onEntries(list.getEntries() as Entry[]));
    observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
  } catch {
    // An entry type this browser does not support. Measured where it exists.
  }
}

export function startWebVitals(): void {
  if (started || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  started = true;

  let lcp: number | null = null;
  const shifts: { value: number; startTime: number; hadRecentInput: boolean }[] = [];
  const events: { interactionId: number; duration: number }[] = [];
  let sent = false;

  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1];
    if (last) lcp = last.renderTime || last.loadTime || last.startTime;
  });
  observe('layout-shift', (entries) => {
    for (const e of entries) {
      shifts.push({ value: e.value ?? 0, startTime: e.startTime, hadRecentInput: Boolean(e.hadRecentInput) });
    }
  });
  const onEvents = (entries: Entry[]) => {
    for (const e of entries) {
      if (e.interactionId) events.push({ interactionId: e.interactionId, duration: e.duration });
    }
  };
  observe('event', onEvents, { durationThreshold: 40 });
  observe('first-input', onEvents);

  const send = () => {
    if (sent) return;
    sent = true;
    const props: Record<string, string | number | boolean> = {};
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      props.ttfb_ms = Math.round(nav.responseStart);
      props.ttfb_rating = rate('ttfb', nav.responseStart);
    }
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    if (fcp) {
      props.fcp_ms = Math.round(fcp.startTime);
      props.fcp_rating = rate('fcp', fcp.startTime);
    }
    if (lcp !== null) {
      props.lcp_ms = Math.round(lcp);
      props.lcp_rating = rate('lcp', lcp);
    }
    if (PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) {
      const cls = clsFromShifts(shifts);
      props.cls = Number(cls.toFixed(4));
      props.cls_rating = rate('cls', cls);
    }
    const inp = inpFromEvents(events);
    if (inp !== null) {
      props.inp_ms = Math.round(inp);
      props.inp_rating = rate('inp', inp);
    }
    // A phone, the extension's frame and a wide window are different pages to
    // lay out, and a regression usually lives in one of them.
    props.viewport = window.innerWidth < 600 ? 'phone' : window.innerWidth < 1100 ? 'tablet' : 'wide';
    props.embedded = window.self !== window.top;
    reportHealth('web_vitals', props);
    // On the next task, not now: the analytics sink queues an event after an
    // await (the device id), so a flush called synchronously here ran before
    // the event was in the queue and sent nothing -- the local proof caught it.
    setTimeout(() => void flushAnalytics(), 0);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send();
  });
  window.addEventListener('pagehide', send);
}
