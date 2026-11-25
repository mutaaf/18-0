/**
 * The front page's download showcase. Web only: see Showcase.web.tsx.
 *
 * The native bundle is the App Store build, where advertising its own beta is
 * a familiar rejection, so on iOS and Android there is nothing to render and
 * nothing to offer.
 */
export interface ShowcaseProps {
  /**
   * Start a season: the lens last started, as every generic Play does
   * (state/next-season.ts). It used to scroll down to the front page, where
   * the same Play had to be found and pressed again.
   */
  onPlay: () => void;
  /** The lens `onPlay` starts, for the button's label. */
  playing: string;
}

export function Showcase(_props: ShowcaseProps): null {
  return null;
}

export function showcaseOffered(): boolean {
  return false;
}
