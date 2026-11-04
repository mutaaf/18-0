import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { useFlag } from '@/features/flags';
import { loadSkia } from './load';

/**
 * The GPU layer, and the one door into it.
 *
 * Effects are drawn by Skia: Metal on iOS, Vulkan/GL on Android, CanvasKit
 * (WebAssembly) on the web. Every effect lives under `./effects/` and is only
 * ever reached through `gpu()` below, for one reason that is easy to break:
 *
 * **On the web, importing `@shopify/react-native-skia` before CanvasKit has
 * loaded throws.** Its web entry builds the whole API from `global.CanvasKit`
 * the moment the module is evaluated. So an effect module must not be in the
 * startup graph -- it is `import()`ed only after `loadSkia()` has resolved --
 * and `gpu.test.ts` fails the build if any other file imports Skia.
 *
 * Every effect has a fallback, and the fallback is what the screen drew before
 * the effect existed. It is shown while CanvasKit is loading, when the
 * `gpu_effects` flag is off, and when loading fails -- offline on a first
 * visit, or a browser without WebAssembly. A decoration that cannot load is a
 * decoration that is not there, never a blank panel or a spinner.
 */

export { loadSkia };

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    // The fallback is the honest outcome for a player; the reason is for us.
    console.warn('[gpu] effect fell back:', error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Wrap an effect module so it loads after Skia, behind the flag, with a
 * fallback. Call at module scope, once per effect.
 */
export function gpu<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  const Lazy = lazy(() => loadSkia().then(load));
  function GpuEffect({ fallback = null, ...props }: P & { fallback?: ReactNode }) {
    const on = useFlag('gpu_effects');
    if (!on) return <>{fallback}</>;
    return (
      <Fallback fallback={fallback}>
        <Suspense fallback={fallback}>
          <Lazy {...(props as unknown as P)} />
        </Suspense>
      </Fallback>
    );
  }
  return GpuEffect;
}
