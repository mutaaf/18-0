import { Platform, Share, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import type { GameResult } from '@18-0/domain';
import type { ShareRosterRow } from '@/components/ShareCard';

/** The plain-text fallback, used when an image cannot be produced. */
export function shareText(result: GameResult, roster: readonly ShareRosterRow[]): string {
  const lines = roster.map(
    (r) => `${r.slot.padEnd(4)} ${r.name} '${String(r.year).slice(2)}  ${r.rating.toFixed(1)}`,
  );
  return (
    `18-0 — ${result.record.wins}-${result.record.losses} ${result.ending.label.toUpperCase()}\n` +
    `Rating ${result.finalRating.toFixed(1)} · Tier ${result.ending.tier}\n\n${lines.join('\n')}\n\n` +
    `Can you beat this roster?`
  );
}

/**
 * Captures the rendered share card and hands it to the platform.
 *
 * Native gets the share sheet; the web gets a download, since browsers cannot
 * put a file into `navigator.share` reliably. Either way the text version is
 * the fallback, so sharing never simply fails.
 */
export async function shareResult(
  cardRef: React.RefObject<View | null>,
  result: GameResult,
  roster: readonly ShareRosterRow[],
): Promise<'image' | 'text'> {
  const fallback = async () => {
    await Share.share({ message: shareText(result, roster) });
    return 'text' as const;
  };

  if (!cardRef.current) return fallback();

  try {
    const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'data-uri' });

    if (Platform.OS === 'web') {
      const link = document.createElement('a');
      link.href = uri;
      link.download = `18-0-${result.record.wins}-${result.record.losses}.png`;
      link.click();
      return 'image';
    }

    const file = await captureRef(cardRef, { format: 'png', quality: 1 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file, { mimeType: 'image/png', dialogTitle: '18-0' });
      return 'image';
    }
    return fallback();
  } catch {
    return fallback();
  }
}
