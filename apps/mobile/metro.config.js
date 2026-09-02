// Metro tuned for a pnpm workspace: the app imports @18-0/domain and @18-0/data
// straight from their TypeScript sources, so Metro has to watch the whole repo
// and resolve through the symlinked workspace root. Symlink resolution itself
// is Metro's default now, so it is not set here -- expo-doctor flags the
// redundant override, and a hand-set value would only drift from the default.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// The workspace packages are standards-compliant ESM: they import siblings with
// an explicit `./types.js`, which TypeScript rewrites to `.ts` at compile time.
// Metro does not do that rewriting, so it is done here rather than by making
// the packages non-conformant for the sake of one bundler.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const stem = moduleName.slice(0, -3);
    for (const ext of ['.ts', '.tsx']) {
      try {
        return resolve(context, stem + ext, platform);
      } catch {
        // fall through to the next candidate
      }
    }
  }
  return resolve(context, moduleName, platform);
};

/**
 * The operator console is left out of store builds entirely.
 *
 * `/admin` is gated by EXPO_PUBLIC_ADMIN_PIN, but an EXPO_PUBLIC_ value is
 * compiled *into* the bundle — so the PIN is a speed bump, not a boundary, and
 * anyone with the binary can read it. Rather than pretend otherwise, a
 * production bundle simply does not contain the screen: nothing links to it and
 * nothing imports from it, so blocking the file removes it from Expo Router's
 * route context and navigating there lands on the unmatched screen.
 *
 * Development keeps it. An internal build that wants it sets
 * EXPO_INCLUDE_ADMIN=1 (the `preview` EAS profile does).
 */
const includeAdmin =
  process.env.EXPO_INCLUDE_ADMIN === '1' || process.env.NODE_ENV !== 'production';

if (!includeAdmin) {
  const adminFile = path.join(projectRoot, 'app', 'admin.tsx');
  const escaped = adminFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blocked = [new RegExp(`^${escaped}$`)];
  if (config.resolver.blockList) blocked.push(...[].concat(config.resolver.blockList));
  config.resolver.blockList = blocked;
}

module.exports = config;
