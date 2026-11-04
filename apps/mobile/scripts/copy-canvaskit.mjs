/**
 * Put Skia's WebAssembly renderer where the web build serves it.
 *
 * Skia on the web is CanvasKit, and CanvasKit fetches `canvaskit.wasm` at run
 * time. It is served from our own origin rather than a CDN: the game plays
 * offline (invariant 3), and a third-party fetch would be a new party in the
 * privacy policy for the sake of a lighting effect. The file is 8 MB and a
 * build output of the installed package, so it is copied on install rather
 * than committed, and `scripts/verify/web-head.mjs` fails an export without it.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', 'package.json'));
const skia = dirname(require.resolve('@shopify/react-native-skia/package.json'));
const source = join(dirname(createRequire(join(skia, 'package.json')).resolve('canvaskit-wasm/package.json')), 'bin', 'full', 'canvaskit.wasm');
const target = join(here, '..', 'public', 'canvaskit.wasm');

if (!existsSync(source)) {
  console.error(`copy-canvaskit: ${source} is missing; the web build will draw no GPU effects`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log('copy-canvaskit: public/canvaskit.wasm');
