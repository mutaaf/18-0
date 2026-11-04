/**
 * Native: Skia is linked into the app (Metal on iOS), so there is nothing to
 * load. The web version is `load.web.ts`; it is a separate file rather than a
 * `Platform.OS` branch because Metro resolves an `import()` even on a branch
 * that never runs, and CanvasKit's loader requires Node's `fs`, which no native
 * bundle has -- both native builds failed on exactly that.
 */
export function loadSkia(): Promise<void> {
  return Promise.resolve();
}
