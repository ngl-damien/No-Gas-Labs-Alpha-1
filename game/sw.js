const CACHE_PREFIX = 'ngl-common-ground-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v1';

// Only the public application shell is cached. Shared-world APIs, authenticated
// state, private server data, and retained artifact endpoints are never cached.
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

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_SHELL);
    // Artwork is useful but must not prevent a text-and-code shell from
    // installing when a slow or partial connection drops an optional image.
    await Promise.all(OPTIONAL_SHELL.map(async path => {
      try { await cache.add(path); } catch { /* optional offline artwork */ }
    }));
    await self.skipWaiting();
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
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(url.pathname, response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match(request) ||
          await cache.match('/index.html') ||
          Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      return Response.error();
    }
  })());
});
