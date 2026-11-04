import { Platform, Share, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import type { GameResult } from '@17-0/domain';
import type { ShareRosterRow } from '@/components/ShareCard';
import {
  SHARE_URL,
  isShareCancel,
  shareBody,
  shareFileName,
  shareText,
  webShareRoute,
} from './share-text';

/**
 * Where a share actually points.
 *
 * Every route out of the app carries this: the text, the OS share sheet's URL
 * field, and, because Android's file share drops the text entirely, the
 * exported image itself. A share that lands somewhere with no way back to the
 * game is just a screenshot.
 *
 * Defined in `links.ts` so that `app/+html.tsx`, which renders the page's head
 * at build time in Node, can use the same value without importing React Native.
 */
export { APP_URL, APP_URL_LABEL } from './links';
export { SHARE_URL, shareFileName, shareHeadline, shareText } from './share-text';

/** Kept for callers that pass a roster: every share goes to the canonical page. */
export function challengeUrl(_roster: readonly ShareRosterRow[]): string {
  return SHARE_URL;
}

/**
 * How a share went, so the screen can say so. `cancelled` says nothing: the
 * player closed the sheet on purpose.
 */
export type ShareOutcome = 'image' | 'text' | 'link' | 'copied' | 'cancelled' | 'failed';

type WebNavigator = Navigator & {
  canShare?: (data: unknown) => boolean;
  share?: (data: unknown) => Promise<void>;
};

const webNavigator = () => globalThis.navigator as WebNavigator | undefined;

/**
 * The card, captured ahead of the tap, for a browser whose share sheet takes
 * files. Null everywhere else, and null on any failure: the tap then shares
 * the link, which is still a share. See `webShareRoute` for why ahead.
 */
export async function prepareWebShareFile(
  cardRef: React.RefObject<View | null>,
  result: GameResult,
): Promise<File | null> {
  if (Platform.OS !== 'web' || !cardRef.current) return null;
  const nav = webNavigator();
  if (!nav?.share || typeof File === 'undefined') return null;
  try {
    const dataUri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'data-uri' });
    const blob = await (await fetch(dataUri)).blob();
    const file = new File([blob], shareFileName(result), { type: 'image/png' });
    if (nav.canShare && !nav.canShare({ files: [file] })) return null;
    return file;
  } catch {
    return null;
  }
}

/**
 * Captures the rendered share card and hands it to the platform.
 *
 * Three different routes, because the platforms genuinely differ:
 *
 * - **iOS** takes an image and a caption together, so it gets both and the link
 *   rides in the caption.
 * - **Android**'s file share silently drops any accompanying text, so the link
 *   has to be printed on the card itself, which it is.
 * - **The web** shares the card captured ahead of the tap, or the text and the
 *   link, and with no share sheet copies the whole share and downloads the card.
 *
 * Every path falls back to text, so sharing never simply fails.
 */
export async function shareResult(
  cardRef: React.RefObject<View | null>,
  result: GameResult,
  roster: readonly ShareRosterRow[],
  prepared: File | null = null,
): Promise<ShareOutcome> {
  if (Platform.OS === 'web') return shareOnWeb(cardRef, result, roster, prepared);

  const message = shareText(result, roster);
  const fallback = async (): Promise<ShareOutcome> => {
    await Share.share(Platform.OS === 'ios' ? { message, url: SHARE_URL } : { message });
    return 'text';
  };

  if (!cardRef.current) return fallback();

  try {
    const file = await captureRef(cardRef, { format: 'png', quality: 1 });

    if (Platform.OS === 'ios') {
      await Share.share({ url: file, message });
      return 'image';
    }

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file, { mimeType: 'image/png', dialogTitle: '17-0' });
      return 'image';
    }
    return await fallback();
  } catch {
    return await fallback();
  }
}

async function shareOnWeb(
  cardRef: React.RefObject<View | null>,
  result: GameResult,
  roster: readonly ShareRosterRow[],
  prepared: File | null,
): Promise<ShareOutcome> {
  const nav = webNavigator();
  const message = shareText(result, roster);
  const route = webShareRoute({
    share: typeof nav?.share === 'function',
    fileReady: prepared !== null,
    canShareFile: !!prepared && (!nav?.canShare || nav.canShare({ files: [prepared] })),
  });

  if (route !== 'copy') {
    try {
      // Nothing is awaited before this call: it has to run inside the tap.
      await nav!.share!(
        route === 'files'
          ? { files: [prepared], text: message }
          : { text: shareBody(result, roster), url: SHARE_URL },
      );
      return route === 'files' ? 'image' : 'link';
    } catch (error) {
      if (isShareCancel(error)) return 'cancelled';
      // Refused (no gesture left, a policy): the clipboard below still works
      // in most browsers, and says so when it does not.
    }
  }

  const copied = await Clipboard.setStringAsync(message).then(
    (ok) => ok !== false,
    () => false,
  );

  // A desktop browser gets the card as a file to post. After the copy, so a
  // slow capture never costs the clipboard its gesture.
  if (route === 'copy') {
    try {
      const dataUri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'data-uri' });
      const link = document.createElement('a');
      link.href = dataUri;
      link.download = shareFileName(result);
      link.click();
    } catch {
      // The text is the share; the image is a bonus.
    }
  }
  return copied ? 'copied' : 'failed';
}
