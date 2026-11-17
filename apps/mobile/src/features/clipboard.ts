import { isTV } from '@/features/tv/platform';

/**
 * expo-clipboard, or an honest "no" on a television.
 *
 * tvOS has no pasteboard an app can write to and does not link ExpoClipboard,
 * whose native module is looked up at import -- so a static import would stop
 * the TV app at launch. Same names as the module, so a call site changes only
 * its import. A TV gets `false` and `''`, which every caller already handles
 * as "the copy did not happen". `native-imports.test.ts` keeps it the only
 * importer.
 */
type ExpoClipboard = typeof import('expo-clipboard');

let real: ExpoClipboard | null | undefined;
function load(): ExpoClipboard | null {
  if (real === undefined) {
    real = isTV ? null : (require('expo-clipboard') as ExpoClipboard);
  }
  return real;
}

export const clipboardAvailable = !isTV;

export async function setStringAsync(text: string): Promise<boolean> {
  const clipboard = load();
  return clipboard ? clipboard.setStringAsync(text) : false;
}

export async function getStringAsync(): Promise<string> {
  const clipboard = load();
  return clipboard ? clipboard.getStringAsync() : '';
}
