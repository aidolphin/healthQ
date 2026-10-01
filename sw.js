// sw.js - offline shell for HealthQ
//
// WHAT IS PRECACHED
// The application shell and the compact food index. The raw data/*.js sources
// are build-time inputs only (see tools/build-index.mjs) and are deliberately
// NOT precached: caching them wasted roughly 23 MB of storage for files the
// browser never requests at runtime. data/detail.js is large and only needed
// when someone expands a food's nutrient table, so it is fetched on demand
// and cached by the fetch handler as it arrives.

const CACHE = 'healthq-v17';

const EAGER = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './nutrition.js',
  './src/main.js',
  './src/core/dom.js',
  './src/core/notices.js',
  './src/core/storage.js',
  './src/core/tabs.js',
  './src/services/attribution.js',
  './src/services/dailyNutrition.js',
  './src/services/healthProfile.js',
  './src/services/suggestions.js',
  './src/features/calculator.js',
  './src/features/day.js',
  './src/features/dialogs.js',
  './src/features/discover.js',
  './src/features/entryDialogs.js',
  './src/features/health.js',
  './src/features/onboarding.js',
  './src/features/settings.js',
  './src/features/account.js',
  './src/features/accountFlows.js',
  './data/catalogue.js',
  './data/search.js',
  './data/nutrients.js',
  './data/provenance.json',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

// Concurrent requests for the same URL share one network fetch. Without this
// the worker re-fetches files the page is already loading, which doubles
// traffic and causes clients to cancel requests mid-transfer.
const inFlight = new Map();

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(EAGER.map(file => cache.add(file))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/** The shell is revalidated in the background; data and icons are cache-only. */
function isShellFile(url) {
  return EAGER.some(file => new URL(file, self.location).pathname === url.pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  let networkFetch = inFlight.get(request.url);
  if (!networkFetch) {
    networkFetch = fetch(request)
      .then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => null)
      .finally(() => inFlight.delete(request.url));
    inFlight.set(request.url, networkFetch);
  }

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request, { ignoreSearch: true });

      if (!isShellFile(url)) {
        if (cached) return cached;
        const fresh = await networkFetch;
        if (fresh) return fresh;
        return new Response('Offline and not cached.', { status: 503, statusText: 'Offline' });
      }

      // Serve instantly, refresh quietly in the background. A pure cache-first
      // strategy is what previously pinned users to a stale build.
      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }

      const fresh = await networkFetch;
      if (fresh) return fresh;

      const shell = await cache.match('./index.html');
      if (shell) return shell;
      return new Response('Offline and not cached.', { status: 503, statusText: 'Offline' });
    }),
  );
});
