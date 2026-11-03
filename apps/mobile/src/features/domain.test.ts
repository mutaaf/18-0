import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_HOST, APP_URL } from './links';

/**
 * The domain is one constant in `links.ts`, and these are the places that
 * cannot import it: HTML a bundler never sees, a JSON listing a store script
 * reads, an extension shipped as plain files, and scripts run by Node. Each
 * one has to say the same address, or a domain move leaves a canonical tag
 * pointing at the old site, a store listing with a dead privacy link, or an
 * extension that ignores every message from the new origin -- and none of
 * those fails anything else.
 *
 * When the domain changes, change `APP_HOST` and this names what is left.
 */
const MOBILE = join(__dirname, '..', '..');
const ROOT = join(MOBILE, '..', '..');
const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8');

/**
 * Every https URL that is not a known third party. A new third-party link in
 * one of these files lands here as a failure naming it; add its host below.
 */
function gameUrls(source: string): string[] {
  return [...source.matchAll(/https:\/\/(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)<]*/gi)]
    .map((m) => m[0])
    .filter((url) => !/(espn|google|apple|github|supabase|mutaafaziz|workers\.dev|schema\.org|w3\.org|posthog|vercel|gstatic|digitalcraftai)/i.test(url));
}

describe('the domain is said in one place', () => {
  const files: [string, string][] = [
    ['public/index.html', read(MOBILE, 'public', 'index.html')],
    ['public/privacy.html', read(MOBILE, 'public', 'privacy.html')],
    ['store/listing.json', read(MOBILE, 'store', 'listing.json')],
    ['scripts/make-store-screenshots.mjs', read(MOBILE, 'scripts', 'make-store-screenshots.mjs')],
    ['extensions/espn-watch/content.js', read(ROOT, 'extensions', 'espn-watch', 'content.js')],
    ['extensions/espn-watch/config.js', read(ROOT, 'extensions', 'espn-watch', 'config.js')],
    ['scripts/verify/web-head.mjs', read(ROOT, 'scripts', 'verify', 'web-head.mjs')],
  ];

  it.each(files)('%s names the game by APP_URL', (_name, source) => {
    const urls = gameUrls(source);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => !url.startsWith(APP_URL))).toEqual([]);
  });

  it('the extension trusts messages from the domain', () => {
    const content = read(ROOT, 'extensions', 'espn-watch', 'content.js');
    expect(content).toContain(`event.origin !== '${APP_URL}'`);
  });

  it('the link-preview image prints the domain', () => {
    // make-og.py writes og.png; a domain move means re-running it.
    expect(read(MOBILE, 'scripts', 'make-og.py')).toContain(`'${APP_HOST.toUpperCase()}'`);
  });
});
