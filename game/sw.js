const CACHE_PREFIX = 'ngl-common-ground-shell-';
// Keep the cache namespace stable while shell entries remain compatible. Network-first
// requests refresh online bytes in place and preserve optional assets cached offline.
const CACHE_NAME = CACHE_PREFIX + '20261104-commons-1';

// Cache only the public application shell. Shared APIs, authenticated state,
// private server data, and retained artifact endpoints are deliberately excluded.
const CORE_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/app-icon.svg',
  '/styles.css',
  '/client.mjs',
  '/quests.mjs',
  '/character-sheet.mjs',
  '/player-position.mjs',
  '/world-view.mjs',
  '/pixel-world-view.mjs',
  '/guild-npc-workbench.mjs',
  '/collaborator-contracts.mjs',
  '/collaborator-response.mjs',
  '/social.mjs',
  '/strict-json.mjs',
  '/model.mjs',
  '/artifacts.mjs',
  '/launchpad.mjs',
  '/institution-view.mjs',
  '/contradiction-clerk.mjs',
  '/chronicle.mjs',
  '/research-records.mjs',
  '/timestamps.mjs'
];
const OPTIONAL_SHELL = [
  '/assets/comic/cover_a.jpg',
  '/assets/comic/p3.jpg',
  '/assets/comic/p4.jpg',
  '/assets/comic/p5.jpg',
  '/assets/comic/p10.jpg',
  '/assets/comic/p13.jpg'
];
const SHELL_PATHS = new Set([...CORE_SHELL, ...OPTIONAL_SHELL]);

// Cache Storage is a resilience layer after installation, not a prerequisite
// for returning a successful online response. Quota and permission failures
// must not hide fresh network content behind stale cache entries.
async function openCache() {
  try { return await caches.open(CACHE_NAME); } catch { return null; }
}

async function matchCache(cache, request) {
  if (!cache) return null;
  try { return await cache.match(request) || null; } catch { return null; }
}

async function cacheResponse(cache, request, response) {
  if (!cache || !response?.ok) return;
  try { await cache.put(request, response.clone()); } catch {}
}

async function offlineNavigation(request) {
  const cache = await openCache();
  return await matchCache(cache, request) ||
    await matchCache(cache, new URL('/index.html', self.location.origin).href) ||
    Response.error();
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_SHELL.map(path => new URL(path, self.location.origin).href));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search ||
      url.pathname === '/api' || url.pathname.startsWith('/api/') ||
      !SHELL_PATHS.has(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      let response;
      try {
        response = await fetch(request);
      } catch {
        return offlineNavigation(request);
      }
      if (!response.ok && response.status >= 500 && response.status <= 599) {
        const fallback = await offlineNavigation(request);
        if (fallback?.ok) return fallback;
      }
      await cacheResponse(await openCache(), request, response);
      return response;
    })());
    return;
  }

  // Shell assets are network-first so an installed client does not remain pinned
  // to stale JavaScript/CSS after a release. Cache Storage is the offline fallback;
  // client errors such as 404 remain visible instead of being hidden by old bytes.
  event.respondWith((async () => {
    const cache = await openCache();
    let response;
    try {
      response = await fetch(request);
    } catch {
      return await matchCache(cache, request) || Response.error();
    }
    if (!response.ok && response.status >= 500 && response.status <= 599) {
      const fallback = await matchCache(cache, request);
      if (fallback?.ok) return fallback;
    }
    await cacheResponse(cache, request, response);
    return response;
  })());
});
