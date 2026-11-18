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
    // Not '17-0', and it is load-bearing. This string is both the label under
    // the icon and what prebuild sanitises into the Xcode target name -- and
    // '17-0' sanitises to '170', which is purely numeric. An Xcode project is a
    // plist, so that gets written `name = 170;` unquoted and read back by every
    // parser as the *number* 170; EAS then looks up the target by the string,
    // matches nothing, and the build dies at "Configure Xcode project" saying
    // `Could not find target '170' in project.pbxproj` (learned as '180', when
    // the game was 18-0). The plugin below puts '17-0' back on both home
    // screens.
    name: 'Seventeen Zero',
    slug: 'eighteen-zero',
    scheme: 'eighteenzero',
    version: '1.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    backgroundColor: '#070E3A',
    primaryColor: '#5FBB46',
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
        backgroundColor: '#070E3A',
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
      // The iOS 27 SDK kills an app without a scene delegate at launch; see the plugin.
      './plugins/with-scene-lifecycle',
      './plugins/without-push-entitlement',
      // StoreKit 2 for the respin packs (docs/respins.md). Its iOS side is a
      // Swift package the Podfile pulls; the store code only loads on iOS.
      'expo-iap',
      // The Apple TV's sound effects (src/features/tv/sound.ts); a phone links
      // it and never loads it. Listed only to say what it may not add: no
      // background audio mode (App Review asks why a game wants one) and no
      // record permission on Android. iOS still needs a microphone string
      // because the library's recorder is in the binary; nothing calls it.
      [
        'expo-audio',
        {
          microphonePermission: '17-0 never records audio. Its sound library asks for this; nothing in the app uses it.',
          recordAudioAndroid: false,
          enableBackgroundPlayback: false,
          enableBackgroundRecording: false,
        },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 180,
          resizeMode: 'contain',
          backgroundColor: '#070E3A',
        },
      ],
      // Apple TV (docs/apple-tv.md). Inert unless EXPO_TV=1, so a phone
      // prebuild is what it was; with it, the same Xcode target is rewritten
      // for tvOS (SDKROOT appletvos, device family 3) and gets the layered
      // icon and Top Shelf that `scripts/make-tv-icons.py` draws. Last, so it
      // sees every other plugin's Podfile and project edits.
      [
        '@react-native-tvos/config-tv',
        {
          tvosDeploymentTarget: '17.0',
          appleTVImages: {
            iconSmallLayers: { front: './assets/tv/icon-small-front.png', back: './assets/tv/icon-small-back.png' },
            iconSmall2xLayers: { front: './assets/tv/icon-small@2x-front.png', back: './assets/tv/icon-small@2x-back.png' },
            iconLayers: { front: './assets/tv/icon-front.png', back: './assets/tv/icon-back.png' },
            topShelf: './assets/tv/top-shelf.png',
            topShelf2x: './assets/tv/top-shelf@2x.png',
            topShelfWide: './assets/tv/top-shelf-wide.png',
            topShelfWide2x: './assets/tv/top-shelf-wide@2x.png',
          },
        },
      ],
    ],

    // EAS needs to know which project a build belongs to, and it cannot write
    // this itself: `eas init` edits app.json, and this config is a function of
    // the environment so it has to be a .js file. Without it every build
    // command stops and asks to create a *second* project.
    owner: 'mutaaf',
    //
    // `buildId` is what an error report says it came from on the web, which has
    // no build number of its own: the commit Vercel or the Pages workflow built.
    // Native builds report their store build number instead
    // (features/diagnostics/context.ts), so this is only the fallback there.
    extra: {
      eas: { projectId: 'ea84b387-544b-46ac-a0e1-0e0f9a5ea492' },
      buildId: (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? '').slice(0, 7) || null,
    },

    experiments: { typedRoutes: true, ...(baseUrl ? { baseUrl } : {}) },
  },
};
