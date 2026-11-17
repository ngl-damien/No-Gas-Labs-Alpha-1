const CACHE_PREFIX = 'ngl-common-ground-shell-';
// Bump the cache namespace when shell modules or cache lifecycle semantics change so installed clients receive them.
// Network-first requests refresh online bytes in place and preserve optional assets cached offline.
const CACHE_NAME = CACHE_PREFIX + '20261117-source-predicate-server-retention-ack-20';

// Cache Storage is best-effort. A stalled browser storage promise must not pin
// an offline navigation or keep a service-worker fetch event alive indefinitely.
const CACHE_OPERATION_TIMEOUT_MS = 1000;
// addAll also fetches the shell over the network; allow slow mobile links more time.
const SHELL_INSTALL_TIMEOUT_MS = 30000;

// Cache only the public application shell. Shared APIs, authenticated state,
// private server data, and retained artifact endpoints are deliberately excluded.
const CORE_SHELL = [
  // project-state.json is generated only for native APK builds; its absence must not block the generic PWA shell.
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/app-icon.svg',
  '/styles.css',
  '/client.mjs',
  '/offline-shell.mjs',
  '/github-decision-gate.mjs',
  '/project-state-snapshot.mjs',
  '/quests.mjs',
  '/character-sheet.mjs',
  '/field-items.mjs',
  '/player-position.mjs',
  '/world-view.mjs',
  '/pixel-world-view.mjs',
  '/guild-npc-workbench.mjs',
  '/collaborator-contracts.mjs',
  '/collaborator-response.mjs',
  '/social.mjs',
  '/strict-json.mjs',
  '/model.mjs','/combat.mjs',
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
function boundedCacheOperation(operation, timeoutMs = CACHE_OPERATION_TIMEOUT_MS) {
  return new Promise(resolve => {
    let settled = false;
    let timer;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value ?? null);
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    Promise.resolve().then(operation).then(finish, () => finish(null));
  });
}

// Installation is stricter than ordinary cache maintenance: do not activate a
// new worker unless its complete public shell was populated. A bounded failure
// rejects installation so the browser can keep the previously active worker.
async function requiredCacheOperation(operation, label, timeoutMs = CACHE_OPERATION_TIMEOUT_MS) {
  let failure = null;
  const result = await boundedCacheOperation(async () => {
    try {
      return await operation();
    } catch (error) {
      failure = error;
      return null;
    }
  }, timeoutMs);
  if (result === null) {
    const detail = failure && typeof failure.message === 'string'
      ? ': ' + failure.message
      : ': timed out';
    throw new Error(label + detail);
  }
  return result;
}

async function openCache() {
  return await boundedCacheOperation(() => caches.open(CACHE_NAME));
}

async function matchCache(cache, request) {
  if (!cache) return null;
  return await boundedCacheOperation(() => cache.match(request));
}

async function preserveOptionalShellAssets(staleNames) {
  if (!Array.isArray(staleNames) || staleNames.length === 0 || OPTIONAL_SHELL.length === 0) return;
  // Inspect only the three newest prior NGL shell caches. These are public,
  // allowlisted game images; authenticated state and API responses are never copied.
  const sourceNames = [...staleNames].sort().reverse().slice(0, 3);
  const currentResult = await boundedCacheOperation(async () => ({
    cache: await caches.open(CACHE_NAME)
  }));
  const current = currentResult?.cache;
  if (!current) return;
  const priorCaches = (await Promise.all(sourceNames.map(async name => {
    const opened = await boundedCacheOperation(async () => ({
      cache: await caches.open(name)
    }));
    return opened?.cache || null;
  }))).filter(Boolean);

  await Promise.all(OPTIONAL_SHELL.map(async path => {
    const url = new URL(path, self.location.origin).href;
    // Wrap the match result so a successful cache miss is distinct from a
    // stalled/failed Cache Storage operation. On uncertainty, do not overwrite.
    const existing = await boundedCacheOperation(async () => ({
      response: await current.match(url)
    }));
    if (!existing || existing.response) return;
    for (const priorCache of priorCaches) {
      const previous = await boundedCacheOperation(async () => ({
        response: await priorCache.match(url)
      }));
      if (!previous?.response?.ok || typeof previous.response.clone !== 'function') continue;
      const stillMissing = await boundedCacheOperation(async () => ({
        response: await current.match(url)
      }));
      if (!stillMissing || stillMissing.response) return;
      await boundedCacheOperation(() => current.put(url, previous.response.clone()));
      return;
    }
  }));
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
    const cache = await requiredCacheOperation(
      () => caches.open(CACHE_NAME),
      'Offline shell cache open failed'
    );
    await requiredCacheOperation(async () => {
      await cache.addAll(CORE_SHELL.map(path => new URL(path, self.location.origin).href));
      return true;
    }, 'Offline shell precache failed', SHELL_INSTALL_TIMEOUT_MS);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Old-cache removal is housekeeping, not a prerequisite for the current
    // shell. Cache reads always use CACHE_NAME, so a stale-cache failure must
    // not strand an otherwise installable offline client on its old worker.
    const names = await boundedCacheOperation(() => caches.keys()) || [];
    const staleNames = names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
    // Carry forward only allowlisted optional artwork before deleting the old
    // shell. Migration is best-effort and every Cache Storage operation is bounded.
    await preserveOptionalShellAssets(staleNames);
    await Promise.all(staleNames.map(name =>
      boundedCacheOperation(() => caches.delete(name))));
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
