import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { color } from '@/theme';

/**
 * The crown.
 *
 * Gold appears all over this app because gold is the brand — but the crown is
 * reserved. Nothing wears one except an earned 18-0, so the first time a player
 * sees it is the moment they earned it.
 */
export function Crown({
  size = 24,
  tint = color.gold,
  bright = color.goldBright,
}: {
  size?: number;
  tint?: string;
  bright?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <LinearGradient id="crownFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={bright} />
          <Stop offset="0.55" stopColor={tint} />
          <Stop offset="1" stopColor={color.goldDeep} />
        </LinearGradient>
      </Defs>
      {/* Five spikes, centre tallest, on a solid band. */}
      <Path
        d="M3 8.4 L5.3 13.2 L7.6 6.2 L9.8 12.6 L12 3.2 L14.2 12.6 L16.4 6.2 L18.7 13.2 L21 8.4 L21 16.4 L3 16.4 Z"
        fill="url(#crownFill)"
      />
      <Path d="M2.6 17.4 H21.4 V20.4 H2.6 Z" fill="url(#crownFill)" />
      {/* Ball finials, as on the brand mark. */}
      <Path d="M3 8.4 m-1.5 0 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0" fill={bright} />
      <Path d="M21 8.4 m-1.5 0 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0" fill={bright} />
      <Path d="M12 3.2 m-1.6 0 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0" fill={bright} />
    </Svg>
  );
}
