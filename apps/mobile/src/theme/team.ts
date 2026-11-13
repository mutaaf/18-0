/**
 * A franchise's generated colour, made legible on the app's dark ground.
 *
 * The palettes are generated per franchise (`franchiseColors` in the data
 * build) rather than taken from any club, and they sit at 46-54% lightness:
 * fine as a card's wash, too dark as text on navy -- the blues all but vanish.
 * As ink they are lifted toward white until they clear a luminance floor, so
 * the hue stays the franchise's and the text stays readable.
 */
export function teamInk(hex: string, floor = 0.34): string {
  const rgb = parse(hex);
  if (!rgb) return hex;
  let mix = 0;
  let out = rgb;
  while (luminance(out) < floor && mix < 0.9) {
    mix += 0.05;
    out = rgb.map((c) => c + (255 - c) * mix) as [number, number, number];
  }
  return `#${out.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** The same colour as a translucent wash, for a chip behind its ink. */
export function teamWash(hex: string, alpha = 0.22): string {
  const rgb = parse(hex);
  return rgb ? `rgba(${rgb.join(',')},${alpha})` : hex;
}

function parse(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
