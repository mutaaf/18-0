import { Platform } from 'react-native';
import { adsOn } from '@/features/ads';

/**
 * A Marquee banner, web only.
 *
 * A plain DOM element rather than a View: the loader fills elements carrying
 * `data-marquee`, and marks them `hidden` when there is no fill -- so no
 * `display` here, or the inline style would beat the `hidden` attribute and
 * leave an empty box on the page. With no fill, which is every page until
 * AdSense is approved, this takes no space at all.
 */
export function AdSlot({ id }: { id: string }) {
  if (Platform.OS !== 'web' || !adsOn()) return null;
  return (
    <div
      data-marquee={id}
      aria-label="Advertisement"
      style={{ width: '100%', maxWidth: 728, alignSelf: 'center', margin: '24px auto 0', position: 'relative' }}
    />
  );
}
