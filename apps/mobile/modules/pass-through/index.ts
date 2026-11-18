/**
 * The binding to `PassThroughView` (ios/PassThroughModule.swift): a plain
 * container the tvOS focus engine sees through.
 *
 * On an Apple TV only. Everywhere else `pointerEvents="none"` already does the
 * job and the answer is React Native's own `View`. A binary without the
 * module linked gets `View` too: `requireNativeView` hands back a component
 * whether or not the native side exists, and Fabric draws a missing one as a
 * magenta "Unimplemented component" box -- full-screen, here. That happened
 * once already, when the podspec asked for a newer tvOS than the app targets
 * and CocoaPods left the pod out without a word.
 */
import { Platform, View, type ViewProps } from 'react-native';
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';

let resolved: ComponentType<ViewProps> | undefined;

export function passThroughView(): ComponentType<ViewProps> {
  if (resolved) return resolved;
  if (Platform.OS !== 'ios' || !Platform.isTV) return (resolved = View);
  try {
    resolved = requireOptionalNativeModule('PassThrough') ? requireNativeView<ViewProps>('PassThrough') : View;
  } catch {
    resolved = View;
  }
  return resolved;
}
