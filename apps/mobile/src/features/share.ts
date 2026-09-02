import { Platform, Share, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import type { GameResult } from '@18-0/domain';
import type { ShareRosterRow } from '@/components/ShareCard';

/**
 * Where a share actually points.
 *
 * Every route out of the app carries this: the text, the OS share sheet's URL
 * field, and — because Android's file share drops the text entirely — the
 * exported image itself. A share that lands somewhere with no way back to the
 * game is just a screenshot.
 */
export const APP_URL = 'https://mutaaf.github.io/18-0/';

/** The same link with the roster in it, so a share can be opened as a rematch. */
export function challengeUrl(roster: readonly ShareRosterRow[]): string {
  const seed = roster.map((r) => `${r.abbr}${String(r.year).slice(2)}`).join('-');
  return `${APP_URL}?vs=${encodeURIComponent(seed)}`;
}

/** The plain-text share, and the fallback when an image cannot be produced. */
export function shareText(result: GameResult, roster: readonly ShareRosterRow[]): string {
  const lines = roster.map(
    (r) => `${r.slot.padEnd(4)} ${r.name} '${String(r.year).slice(2)}  ${r.rating.toFixed(1)}`,
  );
  const perfect = result.ending.key === 'PERFECT';
  return (
    `18-0 — ${result.record.wins}-${result.record.losses} ${result.ending.label.toUpperCase()}\n` +
    `Rating ${result.finalRating.toFixed(1)} · Tier ${result.ending.tier}\n\n${lines.join('\n')}\n\n` +
    `${perfect ? 'A perfect season. Beat it.' : 'Can you beat this roster?'}\n${challengeUrl(roster)}`
  );
}

/**
 * Captures the rendered share card and hands it to the platform.
 *
 * Three different routes, because the platforms genuinely differ:
 *
 * - **iOS** takes an image and a caption together, so it gets both and the link
 *   rides in the caption.
 * - **Android**'s file share silently drops any accompanying text, so the link
 *   has to be printed on the card itself — which it is.
 * - **The web** tries `navigator.share` with the file, and otherwise downloads
 *   the image and puts the link on the clipboard so there is still something to
 *   paste.
 *
 * Every path falls back to text, so sharing never simply fails.
 */
export async function shareResult(
  cardRef: React.RefObject<View | null>,
  result: GameResult,
  roster: readonly ShareRosterRow[],
): Promise<'image' | 'text'> {
  const message = shareText(result, roster);
  const url = challengeUrl(roster);

  const fallback = async () => {
    await Share.share(Platform.OS === 'ios' ? { message, url } : { message });
    return 'text' as const;
  };

  if (!cardRef.current) return fallback();

  try {
    if (Platform.OS === 'web') return await shareOnWeb(cardRef, result, message, url);

    const file = await captureRef(cardRef, { format: 'png', quality: 1 });

    if (Platform.OS === 'ios') {
      await Share.share({ url: file, message });
      return 'image';
    }

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file, { mimeType: 'image/png', dialogTitle: '18-0' });
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
  message: string,
  url: string,
): Promise<'image' | 'text'> {
  const dataUri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'data-uri' });
  const name = `18-0-${result.record.wins}-${result.record.losses}.png`;

  const nav = globalThis.navigator as
    | (Navigator & { canShare?: (data: unknown) => boolean; share?: (data: unknown) => Promise<void> })
    | undefined;

  if (nav?.share) {
    try {
      const blob = await (await fetch(dataUri)).blob();
      const file = new File([blob], name, { type: 'image/png' });
      const payload = { files: [file], text: message, url };
      if (!nav.canShare || nav.canShare(payload)) {
        await nav.share(payload);
        return 'image';
      }
    } catch {
      // Falls through to the download below rather than losing the share.
    }
  }

  const link = document.createElement('a');
  link.href = dataUri;
  link.download = name;
  link.click();
  await Clipboard.setStringAsync(url).catch(() => {});
  return 'image';
}
