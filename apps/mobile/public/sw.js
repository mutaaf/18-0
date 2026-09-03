/*
 * The service worker.
 *
 * Two reasons it exists, and only one of them is caching.
 *
 * The first is that Chrome will not offer to install a site without one that
 * handles `fetch`. No worker, no install prompt, no matter how complete the
 * manifest is -- which is why this game was not installable at all before.
 *
 * The second is that the game already claims to play offline. That claim was
 * true of the running app -- the dataset is bundled and scoring is local -- and
 * false of the page, which needed the network to load at all. This closes that
 * gap: once you have opened it, it opens again on a plane.
 *
 * Deliberately simple. There is no build step generating a precache manifest,
 * because a hand-written list would go stale silently and a generated one is a
 * toolchain to maintain. Instead: cache-first for the built assets, which are
 * content-hashed and therefore safe to keep forever, and network-first for the
 * HTML shell, so a deploy is picked up on the next load rather than pinned
 * until someone clears their storage.
 */

const VERSION = 'v1';
const SHELL = `18-0-shell-${VERSION}`;
const ASSETS = `18-0-assets-${VERSION}`;

/** The page itself, resolved against wherever this worker was registered. */
const START = new URL('./', self.location).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll([START, `${START}manifest.webmanifest`]))
      // A failed pre-cache must not stop the worker installing. The fetch
      // handler below fills the cache on first use anyway, and a worker that
      // refuses to install takes offline play and installability with it.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('18-0-') && !name.endsWith(VERSION))
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Anything that talks to a server is never served from a cache. A stale
  // leaderboard is worse than no leaderboard, and a cached auth callback would
  // be actively broken.
  if (url.pathname.includes('/auth/') || url.search.includes('code=')) return;

  // The shell: network first, so a deploy lands on the next load. The cache is
  // the fallback for a plane, not the source of truth.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(START, copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(START).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Everything else -- the bundle, the fonts, the icons -- is content-hashed by
  // the exporter, so a hit is always the right answer and a miss is fetched
  // once and kept.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(ASSETS).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        }),
    ),
  );
});
