import type { GameResult } from '@17-0/domain';
import { APP_NAME, APP_URL } from './links';

/**
 * What a shared result says, and how the web build chooses to send it.
 *
 * Pure and react-native free so it runs under `environment: 'node'`;
 * `share.ts` is the half that captures the card and talks to the platform.
 */

/** The fields of the share card a text share needs. Mirrors `ShareRosterRow`. */
export interface ShareTextRow {
  readonly slot: string;
  readonly name: string;
  readonly year: number;
  readonly rating: number;
}

/**
 * Where every share points: the front page, with the slash the canonical tag
 * carries, so a pasted link and the page's own canonical are the same string.
 *
 * It used to append `?vs=BAL06-KC02-...`, which nothing on the other end reads:
 * a parameter that looks like a rematch link and is really just noise. Every
 * share goes to the canonical page until the server can resolve a roster from
 * a token.
 */
export const SHARE_URL = `${APP_URL}/`;

type ShareableResult = Pick<GameResult, 'record' | 'ending' | 'finalRating'>;

/**
 * The first line, and the only one some previews show: the record, in the
 * player's own voice. "I went 15-2 on 17-0." It is the record the screen
 * shows, so it is true of every season, assisted or not.
 */
export function shareHeadline(result: ShareableResult): string {
  const { wins, losses } = result.record;
  return `I went ${wins}-${losses} on ${APP_NAME}.`;
}

/** The share without its link, for a share sheet that carries the URL separately. */
export function shareBody(result: ShareableResult, roster: readonly ShareTextRow[]): string {
  const perfect = result.ending.key === 'PERFECT';
  const lines = roster.map(
    (r) => `${r.slot.padEnd(4)} ${r.name} '${String(r.year).slice(2)}  ${r.rating.toFixed(1)}`,
  );
  const parts = [
    shareHeadline(result),
    `${result.ending.label} · Rating ${result.finalRating.toFixed(1)} · Tier ${result.ending.tier}`,
  ];
  if (lines.length) parts.push('', ...lines);
  parts.push('', perfect ? 'A perfect season. Beat it.' : 'Can you beat this roster?');
  return parts.join('\n');
}

/** The plain-text share, with the link last: what lands on a clipboard or in a native sheet. */
export function shareText(result: ShareableResult, roster: readonly ShareTextRow[]): string {
  return `${shareBody(result, roster)}\n${SHARE_URL}`;
}

/** A filename someone can find again in their downloads. */
export function shareFileName(result: ShareableResult): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const ending = slug(result.ending.label);
  return `18-0-season-${result.record.wins}-${result.record.losses}${ending ? `-${ending}` : ''}.png`;
}

/**
 * How the web build shares, given what this browser can do.
 *
 * - **files**: the share sheet takes the card image. The link rides inside the
 *   text, because iOS drops the `url` field when files are attached.
 * - **link**: a share sheet with no file support (or no image ready). Text and
 *   URL go separately, so the target unfurls the link into the page's preview.
 * - **copy**: no share sheet at all, which is most desktop browsers. The whole
 *   share goes on the clipboard and the card is downloaded.
 *
 * The image has to exist before the tap: `navigator.share` must be called
 * while the tap still counts as a user gesture, and Safari stops counting it
 * during the capture. Captured on the tap, the share threw `NotAllowedError`
 * on iPhones and fell through to a data-URI download nobody could find.
 */
export type WebShareRoute = 'files' | 'link' | 'copy';

export function webShareRoute(caps: { share: boolean; fileReady: boolean; canShareFile: boolean }): WebShareRoute {
  if (!caps.share) return 'copy';
  return caps.fileReady && caps.canShareFile ? 'files' : 'link';
}

/** The user closed the share sheet. Not a failure, and nothing should fall back. */
export function isShareCancel(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}
