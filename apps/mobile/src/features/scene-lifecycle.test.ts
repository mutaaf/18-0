import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The iOS app adopts the UIScene lifecycle.
 *
 * Built against the iOS 27 SDK, an app whose window lives on the app delegate
 * is killed at launch (`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`).
 * Expo 57's template is that app. plugins/with-scene-lifecycle.js rewrites it on
 * every prebuild, and nothing else in the repo would notice if the plugin were
 * dropped from the config or stopped matching the template: until EAS moves to
 * the iOS 27 SDK, every build would still pass, and then the first one after
 * the move would never open.
 */
const ROOT = resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
const plugin = require(resolve(ROOT, 'plugins/with-scene-lifecycle.js')) as {
  patchAppDelegate: (src: string) => string;
  SCENE_DELEGATE: string;
};

// The AppDelegate.swift that `expo prebuild` writes for Expo SDK 57.
const TEMPLATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe('UIScene lifecycle on iOS', () => {
  it('the plugin is registered in the app config', () => {
    const config = readFileSync(resolve(ROOT, 'app.config.js'), 'utf8');
    expect(config).toContain("'./plugins/with-scene-lifecycle'");
  });

  it('moves window creation out of the app delegate', () => {
    const patched = plugin.patchAppDelegate(TEMPLATE);
    expect(patched).not.toContain('UIWindow(frame:');
    expect(patched).not.toContain('startReactNative');
    expect(patched).toContain('self.launchOptions = launchOptions');
    expect(patched).toContain('var launchOptions: [UIApplication.LaunchOptionsKey: Any]?');
  });

  it('is idempotent', () => {
    const once = plugin.patchAppDelegate(TEMPLATE);
    expect(plugin.patchAppDelegate(once)).toBe(once);
  });

  it('fails loudly when the template changes', () => {
    const changed = TEMPLATE.replace('window = UIWindow(frame: UIScreen.main.bounds)', 'window = makeWindow()');
    expect(() => plugin.patchAppDelegate(changed)).toThrow(/template has changed/);
  });

  it('the scene delegate starts React Native and forwards links', () => {
    const scene = plugin.SCENE_DELEGATE;
    expect(scene).toContain('UIWindow(windowScene: windowScene)');
    expect(scene).toContain('startReactNative(');
    expect(scene).toContain('openURLContexts');
    expect(scene).toContain('continue userActivity');
    // A cold-start link must reach both Linking.getInitialURL() and expo-linking,
    // which is where Expo Router reads its first route. Without the second the
    // link opened the Play tab, found on a device under the iOS 27 SDK.
    expect(scene).toContain('launchOptions[.url] = url');
    const connect = scene.slice(scene.indexOf('willConnectTo'), scene.indexOf('startReactNative('));
    expect(connect).toContain('app.application(UIApplication.shared, open: url');
  });
});
