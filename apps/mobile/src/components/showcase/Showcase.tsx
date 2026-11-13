/**
 * The front page's download showcase. Web only: see Showcase.web.tsx.
 *
 * The native bundle is the App Store build, where advertising its own beta is
 * a familiar rejection, so on iOS and Android there is nothing to render and
 * nothing to offer.
 */
export interface ShowcaseProps {
  /** Scroll from the showcase down into the game itself. */
  onPlay: () => void;
}

export function Showcase(_props: ShowcaseProps): null {
  return null;
}

export function showcaseOffered(): boolean {
  return false;
}
