/**
 * The fold, as a browser can see it.
 *
 * Safari 27.1 on iPhone Duo ships the Viewport Segments and Device Posture APIs
 * as a preview behind feature flags (Settings > Apps > Safari > Advanced >
 * Feature Flags); Chromium on Android foldables ships them outright. Where they
 * exist they are read; where they do not, the page reports no fold and the
 * layout falls back to its virtual seam -- the same two panels, centred.
 *
 * Only the JavaScript API is used, never `env(viewport-segment-*)`: one report
 * from a real device has Safari's env() values far larger than the segments,
 * and the JS API is what the layout model needs anyway.
 */
import type { Division, Hinge } from './spread';
import { divisionsFromSegments } from './spread';

interface ViewportWithSegments {
  segments?: readonly DOMRectReadOnly[] | null;
}

interface DevicePosture extends EventTarget {
  type?: 'continuous' | 'folded';
}

export interface WebFold {
  divisions: Division[];
  hinge: Hinge | null;
}

export function readWebFold(): WebFold {
  if (typeof window === 'undefined') return { divisions: [], hinge: null };
  const viewport = (window as unknown as { viewport?: ViewportWithSegments }).viewport;
  const segments = viewport?.segments ?? null;
  const divisions = segments
    ? divisionsFromSegments(segments.map((s) => ({ x: s.x, y: s.y, width: s.width, height: s.height })))
    : [];
  const posture = (navigator as unknown as { devicePosture?: DevicePosture }).devicePosture;
  // The web has no angle. A folded posture is reported as partly open at the
  // book's right angle, which is what the seam's shading reads.
  const hinge: Hinge | null = posture?.type
    ? posture.type === 'folded'
      ? { status: 'partiallyOpen', angle: 90 }
      : { status: 'fullyOpen', angle: 180 }
    : null;
  return { divisions, hinge };
}

/** Calls back whenever the segments or the posture may have changed. */
export function watchWebFold(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const queries = ['(horizontal-viewport-segments: 2)', '(vertical-viewport-segments: 2)']
    .map((q) => (typeof window.matchMedia === 'function' ? window.matchMedia(q) : null))
    .filter((q): q is MediaQueryList => q !== null);
  const posture = (navigator as unknown as { devicePosture?: DevicePosture }).devicePosture;

  window.addEventListener('resize', onChange);
  queries.forEach((q) => q.addEventListener?.('change', onChange));
  posture?.addEventListener?.('change', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    queries.forEach((q) => q.removeEventListener?.('change', onChange));
    posture?.removeEventListener?.('change', onChange);
  };
}
