/**
 * The release notes, read from the one file that holds them.
 *
 * `apps/mobile/store/whats-new.json` is bundled into the app (the What's New
 * sheet) and read here for the store. Two copies of the notes -- one typed into
 * release.mjs at the prompt and one in the app -- would say different things
 * by the second release, and the store page is the one nobody re-reads.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WHATS_NEW = join(ROOT, 'apps', 'mobile', 'store', 'whats-new.json');

/** The entry for one marketing version, or null when none has been written. */
export function whatsNewFor(version, source = JSON.parse(readFileSync(WHATS_NEW, 'utf8'))) {
  return source.versions.find((entry) => entry.version === version) ?? null;
}

/**
 * The App Store's "What's New" text for an entry.
 *
 * The headline leads because Apple shows the first few lines and folds the
 * rest behind "more"; the full notes follow as plain bullets, since the field
 * renders no markup at all.
 */
export function storeText(entry) {
  return [entry.headline, '', ...entry.notes.map((note) => `• ${note}`)].join('\n');
}
