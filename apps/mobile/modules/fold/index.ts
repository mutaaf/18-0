/**
 * The binding to `FoldSensorView` (ios/FoldModule.swift).
 *
 * Resolved lazily and defensively: the view exists only in an iOS build made
 * after this module was added. Android, the web, Expo Go and an iOS binary
 * from before it all get `null`, and the app treats that as "no fold" -- which
 * is the truth on every one of them except the web, which has its own source
 * (`src/features/fold/web.ts`).
 */
import { Platform, type ViewProps } from 'react-native';
import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';

export interface NativeDivision {
  x: number;
  y: number;
  width: number;
  height: number;
  margins: { top: number; left: number; bottom: number; right: number };
  active: boolean;
}

export interface NativeHinge {
  status: 'closed' | 'partiallyOpen' | 'fullyOpen' | 'unknown';
  /** Degrees, 0 closed to 180 flat. Approximate; the system sets the rate. */
  angle: number;
}

export interface FoldChange {
  regions: NativeDivision[];
  hinge?: NativeHinge;
}

export type FoldSensorProps = ViewProps & {
  onFoldChange: (event: { nativeEvent: FoldChange }) => void;
};

let sensor: ComponentType<FoldSensorProps> | null | undefined;

export function foldSensor(): ComponentType<FoldSensorProps> | null {
  if (sensor !== undefined) return sensor;
  if (Platform.OS !== 'ios') return (sensor = null);
  try {
    sensor = requireNativeView<FoldSensorProps>('Fold');
  } catch {
    sensor = null;
  }
  return sensor;
}
