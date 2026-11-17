import { isTV } from '@/features/tv/platform';

/**
 * expo-haptics, or nothing on a television.
 *
 * The same four names the screens always used, so a call site changes only its
 * import. It exists because tvOS does not link ExpoHaptics -- an Apple TV has
 * no Taptic Engine -- and expo-haptics looks its native module up the moment it
 * is imported, so a plain `import * as Haptics from 'expo-haptics'` anywhere in
 * the startup graph kills the TV app before its first frame. Loaded lazily,
 * and never on a TV. `native-imports.test.ts` keeps it the only importer.
 *
 * The enums are restated, with expo-haptics' own values, for the same reason:
 * reading them off the real module would load it.
 */
export const ImpactFeedbackStyle = {
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
  Soft: 'soft',
  Rigid: 'rigid',
} as const;
export type ImpactFeedbackStyle = (typeof ImpactFeedbackStyle)[keyof typeof ImpactFeedbackStyle];

export const NotificationFeedbackType = {
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
} as const;
export type NotificationFeedbackType = (typeof NotificationFeedbackType)[keyof typeof NotificationFeedbackType];

type ExpoHaptics = typeof import('expo-haptics');

let real: ExpoHaptics | null | undefined;
function load(): ExpoHaptics | null {
  if (real === undefined) {
    real = isTV ? null : (require('expo-haptics') as ExpoHaptics);
  }
  return real;
}

export async function impactAsync(style: ImpactFeedbackStyle = ImpactFeedbackStyle.Medium): Promise<void> {
  await load()?.impactAsync(style as Parameters<ExpoHaptics['impactAsync']>[0]);
}

export async function notificationAsync(
  type: NotificationFeedbackType = NotificationFeedbackType.Success,
): Promise<void> {
  await load()?.notificationAsync(type as Parameters<ExpoHaptics['notificationAsync']>[0]);
}

export async function selectionAsync(): Promise<void> {
  await load()?.selectionAsync();
}
