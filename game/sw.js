const CACHE_PREFIX = 'ngl-common-ground-shell-';
// Keep the cache namespace stable while shell entries remain compatible. Network-first
// requests refresh online bytes in place and preserve optional assets cached offline.
const CACHE_NAME = CACHE_PREFIX + '20261104-commons-1';

// Cache Storage is best-effort. A stalled browser storage promise must not pin
// an offline navigation or keep a service-worker fetch event alive indefinitely.
const CACHE_OPERATION_TIMEOUT_MS = 1000;

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
// for returning a successful online response. Quota, permission, and stalled
// operations must not hide fresh network content or pin an event indefinitely.
function boundedCacheOperation(operation) {
  return new Promise(resolve => {
    let settled = false;
    let timer;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value ?? null);
    };
    timer = setTimeout(() => finish(null), CACHE_OPERATION_TIMEOUT_MS);
    Promise.resolve().then(operation).then(finish, () => finish(null));
  });
}

async function openCache() {
  return await boundedCacheOperation(() => caches.open(CACHE_NAME));
}

async function matchCache(cache, request) {
  if (!cache) return null;
  return await boundedCacheOperation(() => cache.match(request));
}

async function cacheResponse(cacheFactory, request, response) {
  if (!response?.ok) return;
  // Clone before awaiting Cache Storage so a slow open cannot let the client
  // consume the original response body before the offline copy is made.
  const cachedResponse = response.clone();
  const cache = await cacheFactory();
  if (!cache) return;
  await boundedCacheOperation(() => cache.put(request, cachedResponse));
}

function scheduleCacheResponse(event, request, responsePromise) {
  const update = responsePromise
    .then(response => cacheResponse(openCache, request, response))
    .catch(() => {});
  try { event.waitUntil(update); } catch {}
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
    const networkResponse = fetch(request);
    scheduleCacheResponse(event, request, networkResponse);
    event.respondWith((async () => {
      let response;
      try {
        response = await networkResponse;
      } catch {
        return offlineNavigation(request);
      }
      if (!response.ok && response.status >= 500 && response.status <= 599) {
        const fallback = await offlineNavigation(request);
        if (fallback?.ok) return fallback;
      }
      return response;
    })());
    return;
  }

  // Shell assets are network-first so an installed client does not remain pinned
  // to stale JavaScript/CSS after a release. Cache Storage is the offline fallback;
  // client errors such as 404 remain visible instead of being hidden by old bytes.
  // Start the network request immediately. Cache Storage may be slow or
  // unavailable; it must never delay a fresh online shell response.
  const networkResponse = fetch(request);
  scheduleCacheResponse(event, request, networkResponse);

  event.respondWith((async () => {
    let response;
    try {
      response = await networkResponse;
    } catch {
      const cache = await openCache();
      return await matchCache(cache, request) || Response.error();
    }
    if (!response.ok && response.status >= 500 && response.status <= 599) {
      const cache = await openCache();
      const fallback = await matchCache(cache, request);
      if (fallback?.ok) return fallback;
    }
    return response;
  })());
});
