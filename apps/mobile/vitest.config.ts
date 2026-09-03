import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Tests for the parts of the app that are not React Native.
 *
 * The app itself is not unit-tested and this is not the beginning of doing so
 * -- rendering is verified by running it. This exists for the modules that are
 * pure logic with rules worth enforcing, starting with the feature-flag
 * registry, whose whole value is that breaking the pattern fails the build.
 *
 * `environment: 'node'`, so anything that imports react-native will simply not
 * run here. That is the constraint that keeps those modules importable and
 * testable in the first place.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // From `process.cwd()` rather than `import.meta.url`: this file is inside
    // the app's tsconfig, whose DOM lib makes the two `URL` types disagree,
    // and vitest already runs with this package as its working directory.
    alias: { '@': resolve(process.cwd(), 'src') },
  },
});
