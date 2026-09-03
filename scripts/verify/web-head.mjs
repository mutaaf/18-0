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

// ---------------------------------------------------------------------------
console.log('\nINSTALLABLE');

// Chrome will not offer to install without all three of these, and the failure
// is silent: no error, no prompt, just a site that never becomes an app. They
// are checked against the exported output because that is what people get.
check('the manifest is linked', /rel="manifest"/i.test(html));
check('a service worker is registered', /serviceWorker\.register/.test(html));
check('iOS is told it can run standalone', contentOf('name', 'apple-mobile-web-app-capable') === 'yes');
check('iOS has an icon to use', /rel="apple-touch-icon"/i.test(html));

const manifestRaw = await readFile(join(dist, 'manifest.webmanifest'), 'utf8').catch(() => null);
check('the manifest was exported', Boolean(manifestRaw));

if (manifestRaw) {
  let manifest = {};
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (problem) {
    check('the manifest is valid JSON', false, String(problem));
  }

  check('it names the app', manifest.name?.length > 4 && manifest.short_name?.length > 1,
    `${manifest.name} / ${manifest.short_name}`);
  check('it describes the app', (manifest.description ?? '').length > 60);
  check('it opens standalone', manifest.display === 'standalone', manifest.display);
  // A start_url outside the scope, or one that 404s on a project site, gives an
  // installed app that opens on an error page.
  check('it starts inside its own scope', String(manifest.start_url ?? '').startsWith(manifest.scope ?? '\u0000'),
    `${manifest.start_url} in ${manifest.scope}`);
  check('the ground matches the app', manifest.background_color === '#06080F' && manifest.theme_color === '#06080F',
    `${manifest.background_color} / ${manifest.theme_color}`);

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  check('it ships a 192 and a 512', icons.some((i) => i.sizes === '192x192') && icons.some((i) => i.sizes === '512x512'),
    icons.map((i) => i.sizes).join(' '));
  // Without a maskable icon Android draws the square art inside its own shape,
  // which on a round-icon launcher clips the corners off.
  check('it ships a maskable icon', icons.some((i) => String(i.purpose ?? '').includes('maskable')));

  for (const icon of icons) {
    const file = await stat(join(dist, icon.src)).catch(() => null);
    check(`${icon.src} was exported`, Boolean(file),
      file ? `${Math.round(file.size / 1024)} KB` : 'missing');
  }
}

const worker = await readFile(join(dist, 'sw.js'), 'utf8').catch(() => null);
check('the service worker was exported', Boolean(worker));
// A worker without a fetch handler satisfies nothing: Chrome's install criteria
// require one, and offline play needs it to do anything at all.
check('it handles fetch', Boolean(worker && /addEventListener\(\s*['"]fetch['"]/.test(worker)));

console.log(failed === 0 ? '\nShareable and installable.\n' : `\n${failed} problem(s).\n`);
process.exit(failed === 0 ? 0 : 1);
