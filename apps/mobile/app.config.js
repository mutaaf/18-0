/**
 * Expo config as JS, for two reasons.
 *
 * The web build targets a GitHub Pages subpath — a project site lives at
 * `/<repo>/`, and Expo Router needs to know that at build time or every asset
 * and route resolves against the domain root.
 *
 * And the store build numbers are read from the environment, so CI can stamp a
 * build without a commit that only bumps an integer.
 */
const baseUrl = process.env.EXPO_BASE_URL ?? undefined;

/** Store builds are versioned separately from the marketing version. */
const buildNumber = process.env.EXPO_BUILD_NUMBER ?? '1';

module.exports = {
  expo: {
    name: '18-0',
    slug: 'eighteen-zero',
    scheme: 'eighteenzero',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    backgroundColor: '#07090C',
    primaryColor: '#D50A0A',
    newArchEnabled: true,

    icon: './assets/icon.png',

    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.eighteenzero.app',
      buildNumber,
      config: {
        // The app ships no encryption beyond HTTPS, which is exempt. Declaring
        // it here answers App Store Connect's export-compliance question once
        // instead of on every single upload.
        usesNonExemptEncryption: false,
      },
    },

    android: {
      package: 'com.eighteenzero.app',
      versionCode: Number(buildNumber),
      edgeToEdgeEnabled: true,
      adaptiveIcon: {
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
        backgroundColor: '#07090C',
      },
    },

    web: { bundler: 'metro', output: 'single', favicon: './assets/favicon.png' },

    plugins: [
      'expo-router',
      'expo-font',
      // Required for the OAuth round trip: it registers the activity Android
      // needs to hand the redirect back to the app instead of a browser tab.
      'expo-web-browser',
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 180,
          resizeMode: 'contain',
          backgroundColor: '#07090C',
        },
      ],
    ],

    experiments: { typedRoutes: true, ...(baseUrl ? { baseUrl } : {}) },
  },
};
