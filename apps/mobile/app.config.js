/**
 * Expo config as JS, for two reasons.
 *
 * The web build targets a GitHub Pages subpath — a project site lives at
 * `/<repo>/`, and Expo Router needs to know that at build time or every asset
 * and route resolves against the domain root.
 *
 * Store build numbers are deliberately absent. EAS holds them
 * (`cli.appVersionSource: "remote"` in eas.json) and increments on every
 * production build, which is the only arrangement that works here: EAS's
 * `autoIncrement` writes to app.json and refuses to run against a dynamic
 * config at all, and stamping the number from the environment meant remembering
 * to raise it by hand -- App Store Connect rejects a build number it has
 * already seen, so forgetting is a failed upload rather than a warning.
 */
const baseUrl = process.env.EXPO_BASE_URL ?? undefined;

module.exports = {
  expo: {
    // Not '18-0', and it is load-bearing. This string is both the label under
    // the icon and what prebuild sanitises into the Xcode target name -- and
    // '18-0' sanitises to '180', which is purely numeric. An Xcode project is a
    // plist, so that gets written `name = 180;` unquoted and read back by every
    // parser as the *number* 180; EAS then looks up the target by the string
    // '180', matches nothing, and the build dies at "Configure Xcode project"
    // saying `Could not find target '180' in project.pbxproj`. The plugin below
    // puts '18-0' back on both home screens.
    name: 'Eighteen Zero',
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
      bundleIdentifier: 'com.eighteenzerodcai.app',
      config: {
        // The app ships no encryption beyond HTTPS, which is exempt. Declaring
        // it here answers App Store Connect's export-compliance question once
        // instead of on every single upload.
        usesNonExemptEncryption: false,
      },
    },

    android: {
      package: 'com.eighteenzerodcai.app',
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
      './plugins/with-display-name',
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

    // EAS needs to know which project a build belongs to, and it cannot write
    // this itself: `eas init` edits app.json, and this config is a function of
    // the environment so it has to be a .js file. Without it every build
    // command stops and asks to create a *second* project.
    owner: 'mutaaf',
    extra: { eas: { projectId: 'ea84b387-544b-46ac-a0e1-0e0f9a5ea492' } },

    experiments: { typedRoutes: true, ...(baseUrl ? { baseUrl } : {}) },
  },
};
