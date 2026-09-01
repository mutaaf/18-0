// Metro tuned for a pnpm workspace: the app imports @18-0/domain and @18-0/data
// straight from their TypeScript sources, so Metro has to watch the whole repo
// and resolve through the symlinked workspace root.
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
config.resolver.unstable_enableSymlinks = true;

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

module.exports = config;
