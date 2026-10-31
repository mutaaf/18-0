/**
 * Splice Playbill's structured data into the shipped HTML.
 *
 *   node scripts/playbill-head.mjs <dist-dir>
 *
 * Playbill (github.com/mutaaf/playbill) keeps one catalog of every app in the
 * mutaafaziz.com collection and renders the JSON-LD (VideoGame, FAQPage,
 * BreadcrumbList) plus an accessible plain-HTML description that crawlers which
 * don't run JavaScript can read. 18-0.co is a static Vercel site, so it pulls
 * that block at build time instead of at the edge.
 *
 * Never fails the build: no network, no block, same page as before.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const file = join(process.argv[2] ?? 'dist', 'index.html');
try {
  const r = await fetch('https://mutaafaziz.com/playbill/ext/18-0/head.html', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const [head, body] = (await r.text()).split('<!--playbill-body-->');
  if (!head.includes('application/ld+json')) throw new Error('unexpected response');
  let html = await readFile(file, 'utf8');
  html = html.replace('</head>', `${head.trim()}\n</head>`).replace(/<\/body>(?![\s\S]*<\/body>)/, `${(body || '').trim()}\n</body>`);
  await writeFile(file, html);
  console.log('  ✓ Playbill structured data spliced in');
} catch (e) {
  console.log(`  · Playbill block skipped (${e.message}); page ships without it`);
}
