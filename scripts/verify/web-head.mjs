/**
 * Assert that the exported web build can be shared.
 *
 *   node scripts/verify/web-head.mjs <dist-dir>
 *
 * The first attempt at fixing the link preview put the tags in `app/+html.tsx`,
 * which Expo only reads when `web.output` is "static". The export succeeded,
 * the deploy succeeded, and the page went out with exactly the empty <head> it
 * had before. Nothing failed; it just did not work.
 *
 * So this reads the file that actually ships.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const html = await readFile(join(dist, 'index.html'), 'utf8');

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed++;
};

const meta = (attr, value) =>
  new RegExp(`<meta[^>]*${attr}=["']${value}["']`, 'i').test(html);

const contentOf = (attr, value) => {
  const re = new RegExp(`<meta[^>]*${attr}=["']${value}["'][^>]*content=["']([^"']*)["']`, 'i');
  const alt = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${value}["']`, 'i');
  return (re.exec(html) ?? alt.exec(html))?.[1] ?? null;
};

console.log('\nWEB SHARE PREVIEW');

const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
check('the page has a title worth reading', title.length > 6 && title !== '18-0', title);
check('it describes itself', (contentOf('name', 'description') ?? '').length > 60);

for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type']) {
  check(`${tag} is present`, meta('property', tag));
}
check('twitter renders a large card', contentOf('name', 'twitter:card') === 'summary_large_image');

// An og:image that a scraper cannot fetch is worse than none: the preview
// renders as a broken frame rather than falling back to text.
const image = contentOf('property', 'og:image');
check('og:image is absolute', Boolean(image?.startsWith('https://')), `${image}`);

const name = image ? image.split('/').pop() : null;
const asset = name ? await stat(join(dist, name)).catch(() => null) : null;
check('og:image was actually exported', Boolean(asset),
  asset ? `${Math.round(asset.size / 1024)} KB` : `${name} is not in ${dist}`);

console.log(failed === 0 ? '\nShareable.\n' : `\n${failed} problem(s).\n`);
process.exit(failed === 0 ? 0 : 1);
