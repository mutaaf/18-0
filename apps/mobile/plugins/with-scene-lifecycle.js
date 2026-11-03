/**
 * Adopt the UIScene lifecycle on iOS.
 *
 * An app built against the iOS 27 SDK that still keeps its window on the app
 * delegate is killed at launch: UIKit raises
 * `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` before the
 * first frame. Expo 57's template does exactly that, and nothing in Expo or
 * React Native 0.86 offers a scene delegate. A local Release build from Xcode
 * 27.2 crashed this way on 2026-11-02; EAS builds only survived because their
 * image still used the 26.5 SDK, so the crash was one image bump away.
 *
 * This plugin, applied on every prebuild:
 *  - declares a single-window scene in Info.plist (UIApplicationSceneManifest);
 *  - adds SceneDelegate.swift, which owns the window and starts React Native in
 *    it with the factory the AppDelegate still builds;
 *  - removes window creation from AppDelegate.didFinishLaunching, keeping the
 *    launch options for the scene;
 *  - forwards URL opens and Universal Links from the scene to the AppDelegate's
 *    existing handlers. Under scenes iOS stops calling the app-delegate
 *    versions, and those handlers are what feed RCTLinkingManager,
 *    expo-linking and expo-router.
 *
 * A cold-start deep link arrives in the scene's connection options rather than
 * the launch options. It goes to two places: into the launch options React
 * Native reads for `Linking.getInitialURL()`, and through the app delegate's
 * open-url handler, which is where expo-linking (Expo Router's initial route)
 * records it.
 *
 * Each edit to the template matches a known snippet and throws if it is not
 * there, so an Expo upgrade that changes the template fails the prebuild loudly
 * instead of producing an app that silently never starts React Native.
 */
const fs = require('node:fs');
const path = require('node:path');
const { withAppDelegate, withDangerousMod, withInfoPlist, withXcodeProject, IOSConfig } = require('@expo/config-plugins');

const SCENE_CONFIG = 'Default Configuration';

const SCENE_DELEGATE = `internal import Expo
import React
import UIKit

// Written by plugins/with-scene-lifecycle.js on prebuild; edit the plugin, not this file.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var app: AppDelegate? { UIApplication.shared.delegate as? AppDelegate }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene, let app else { return }

    var launchOptions = app.launchOptions ?? [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    if let activity = connectionOptions.userActivities.first {
      launchOptions[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }

    // Expo Router takes its first route from expo-linking, which only records a
    // URL when the app delegate's open-url handler runs. Under scenes a cold
    // launch never calls it, and the link opened the Play tab instead of its
    // route. Forward it before React Native starts, so the URL is waiting
    // when JS asks; RCTLinkingManager's event fires with no listener, which
    // is harmless.
    if let url = connectionOptions.urlContexts.first?.url {
      _ = app.application(UIApplication.shared, open: url, options: [:])
    }
    if let activity = connectionOptions.userActivities.first {
      _ = app.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    app.window = window
    app.reactNativeFactory?.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let app else { return }
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
      if let source = context.options.sourceApplication { options[.sourceApplication] = source }
      if let annotation = context.options.annotation { options[.annotation] = annotation }
      options[.openInPlace] = context.options.openInPlace
      _ = app.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = app?.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }

  // Expo's app-delegate subscribers still hear about these. Under scenes UIKit
  // sends them to the scene, not the app delegate.
  func sceneDidBecomeActive(_ scene: UIScene) { app?.applicationDidBecomeActive(UIApplication.shared) }
  func sceneWillResignActive(_ scene: UIScene) { app?.applicationWillResignActive(UIApplication.shared) }
  func sceneWillEnterForeground(_ scene: UIScene) { app?.applicationWillEnterForeground(UIApplication.shared) }
  func sceneDidEnterBackground(_ scene: UIScene) { app?.applicationDidEnterBackground(UIApplication.shared) }
}
`;

/** Replace exactly one known snippet, or fail the prebuild. */
function replaceOnce(source, find, replacement, what) {
  const at = source.indexOf(find);
  if (at < 0 || source.indexOf(find, at + 1) >= 0) {
    throw new Error(
      `with-scene-lifecycle: could not find ${what} in AppDelegate.swift. ` +
        'The Expo template has changed; update plugins/with-scene-lifecycle.js.',
    );
  }
  return source.slice(0, at) + replacement + source.slice(at + find.length);
}

function patchAppDelegate(src) {
  if (src.includes('// scene-lifecycle')) return src;

  src = replaceOnce(
    src,
    '  var reactNativeFactory: RCTReactNativeFactory?\n',
    '  var reactNativeFactory: RCTReactNativeFactory?\n' +
      '  // scene-lifecycle: SceneDelegate creates the window and starts React Native with these.\n' +
      '  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?\n',
    'the reactNativeFactory property',
  );

  src = replaceOnce(
    src,
    `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`,
    `    self.launchOptions = launchOptions
`,
    'the window creation in didFinishLaunchingWithOptions',
  );

  return src;
}

function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: SCENE_CONFIG,
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });

  config = withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('with-scene-lifecycle: expected a Swift AppDelegate');
    }
    cfg.modResults.contents = patchAppDelegate(cfg.modResults.contents);
    return cfg;
  });

  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName);
      fs.writeFileSync(path.join(dir, 'SceneDelegate.swift'), SCENE_DELEGATE);
      return cfg;
    },
  ]);

  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const name = cfg.modRequest.projectName;
    const filepath = `${name}/SceneDelegate.swift`;
    if (!project.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: name, project });
    }
    return cfg;
  });
}

module.exports = withSceneLifecycle;
module.exports.patchAppDelegate = patchAppDelegate;
module.exports.SCENE_DELEGATE = SCENE_DELEGATE;
