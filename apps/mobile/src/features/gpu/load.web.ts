let loading: Promise<void> | null = null;

/**
 * Web: fetch and start CanvasKit, once. Skia's web entry builds its API from
 * `global.CanvasKit` when imported, so this has to finish before any effect
 * module is evaluated (see `index.tsx`).
 */
export function loadSkia(): Promise<void> {
  loading ??= import('@shopify/react-native-skia/lib/module/web').then(({ LoadSkiaWeb }) =>
    LoadSkiaWeb({
      // Served from our own origin (scripts/copy-canvaskit.mjs), under the same
      // base path as the bundle: empty on the domain, /18-0 on the Pages mirror.
      locateFile: (file: string) => `${(process.env.EXPO_BASE_URL ?? '').replace(/\/+$/, '')}/${file}`,
    }),
  );
  return loading;
}
