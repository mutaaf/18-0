import { Platform } from 'react-native';
import { adsOn } from '@/features/ads';
import { AD_BANNER_RESERVE } from '@/features/ads-policy';

/**
 * A Marquee banner, web only.
 *
 * A plain DOM element rather than a View: the loader fills elements carrying
 * `data-marquee`, and marks them `hidden` when there is no fill -- so no
 * `display` here, or the inline style would beat the `hidden` attribute and
 * leave an empty box on the page.
 *
 * `minHeight` holds the banner's space from the first paint (Marquee's own
 * integration pattern), so a fill that arrives a second later does not push
 * everything under it down the page. `hidden` still wins over it, so with no
 * fill the box collapses the moment the config says so.
 */
export function AdSlot({ id }: { id: string }) {
  if (Platform.OS !== 'web' || !adsOn()) return null;
  return (
    <div
      data-marquee={id}
      aria-label="Advertisement"
      style={{
        width: '100%',
        maxWidth: 728,
        minHeight: AD_BANNER_RESERVE,
        alignSelf: 'center',
        margin: '24px auto 0',
        position: 'relative',
      }}
    />
  );
}
