/**
 * Expo config as JS so the web build can target a GitHub Pages subpath.
 *
 * A project site lives at /<repo>/, and Expo Router needs to know that at build
 * time or every asset and route resolves against the domain root.
 */
const baseUrl = process.env.EXPO_BASE_URL ?? undefined;

module.exports = {
  expo: {
    name: '18-0',
    slug: 'eighteen-zero',
    scheme: 'eighteenzero',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    backgroundColor: '#07090C',
    newArchEnabled: true,
    splash: { backgroundColor: '#07090C', resizeMode: 'contain' },
    ios: { supportsTablet: true, bundleIdentifier: 'com.eighteenzero.app' },
    android: {
      package: 'com.eighteenzero.app',
      edgeToEdgeEnabled: true,
      adaptiveIcon: { backgroundColor: '#07090C' },
    },
    web: { bundler: 'metro', output: 'single' },
    plugins: ['expo-router', 'expo-font'],
    experiments: { typedRoutes: true, ...(baseUrl ? { baseUrl } : {}) },
  },
};
