import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_URL } from './links';
import {
  SHARE_URL,
  isShareCancel,
  shareBody,
  shareFileName,
  shareHeadline,
  shareText,
  webShareRoute,
} from './share-text';

/** Spelled as an escape so this file is not itself the thing it looks for. */
const EM_DASH = /\u2014/;

const season = (wins: number, losses: number, key = 'CONTENDER', label = 'Contender') => ({
  record: { wins, losses },
  ending: { key, label, tier: 'A', wins, losses },
  finalRating: 91.24,
});

const roster = [
  { slot: 'QB', name: 'A. Passer', year: 2007, rating: 97.1 },
  { slot: 'RB1', name: 'B. Runner', year: 1984, rating: 93.4 },
];

describe('what a shared result says', () => {
  it('leads with the record in the player\'s own voice', () => {
    expect(shareHeadline(season(15, 2) as never)).toBe('I went 15-2 on 17-0.');
    expect(shareText(season(15, 2) as never, roster).split('\n')[0]).toBe('I went 15-2 on 17-0.');
  });

  it('ends with the link to the game, the canonical page and nothing appended', () => {
    expect(SHARE_URL).toBe(`${APP_URL}/`);
    expect(SHARE_URL).toBe('https://18-0.co/');
    expect(shareText(season(15, 2) as never, roster).endsWith('\nhttps://18-0.co/')).toBe(true);
  });

  it('keeps the link out of the body a share sheet carries beside its url', () => {
    expect(shareBody(season(15, 2) as never, roster)).not.toContain(APP_URL);
  });

  it('carries the roster and the verdict', () => {
    const text = shareText(season(15, 2) as never, roster);
    expect(text).toContain('Contender · Rating 91.2 · Tier A');
    expect(text).toContain("QB   A. Passer '07  97.1");
    expect(text).toContain('Can you beat this roster?');
  });

  it('a perfect season says so', () => {
    const text = shareText(season(17, 0, 'PERFECT', 'Perfect') as never, roster);
    expect(text.split('\n')[0]).toBe('I went 17-0 on 17-0.');
    expect(text).toContain('A perfect season. Beat it.');
  });

  it('uses no em-dash', () => {
    expect(shareText(season(9, 8) as never, roster)).not.toMatch(EM_DASH);
    expect(shareText(season(17, 0, 'PERFECT', 'Perfect') as never, roster)).not.toMatch(EM_DASH);
  });

  it('names the downloaded card after the season', () => {
    expect(shareFileName(season(15, 2) as never)).toBe('18-0-season-15-2-contender.png');
  });
});

describe('how the web build shares', () => {
  it('copies when the browser has no share sheet', () => {
    expect(webShareRoute({ share: false, fileReady: true, canShareFile: true })).toBe('copy');
  });

  it('shares the card only when it was made before the tap and the sheet takes files', () => {
    expect(webShareRoute({ share: true, fileReady: true, canShareFile: true })).toBe('files');
    expect(webShareRoute({ share: true, fileReady: false, canShareFile: false })).toBe('link');
    expect(webShareRoute({ share: true, fileReady: true, canShareFile: false })).toBe('link');
  });

  it('treats a closed sheet as a choice, not a failure to fall back from', () => {
    expect(isShareCancel({ name: 'AbortError' })).toBe(true);
    expect(isShareCancel({ name: 'NotAllowedError' })).toBe(false);
    expect(isShareCancel(null)).toBe(false);
  });

  it('awaits nothing on the tap before the share sheet opens', () => {
    const source = readFileSync(resolve(__dirname, 'share.ts'), 'utf8');
    const start = source.indexOf('async function shareOnWeb(');
    const sheet = source.indexOf('await nav!.share!(', start);
    expect(sheet).toBeGreaterThan(start);
    expect(source.slice(start, sheet)).not.toMatch(/\bawait\b/);
  });
});

describe('the result screen', () => {
  const source = readFileSync(resolve(__dirname, '../../app/result.tsx'), 'utf8');

  it('offers Share, and prepares the card before the tap', () => {
    expect(source).toContain('accessibilityLabel="Share this result"');
    expect(source).toContain('prepareWebShareFile(cardRef, result)');
    expect(source).toContain('shareResult(cardRef, result, shareRows, shareFile.current)');
  });

  it('writes its share notes without an em-dash', () => {
    const notes = source.slice(source.indexOf('const SHARE_NOTE'), source.indexOf('};', source.indexOf('const SHARE_NOTE')));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes).not.toMatch(EM_DASH);
  });
});
