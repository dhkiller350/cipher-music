const CACHE = 'cipher-v3';
const ASSETS = [
  '/', '/index.html', '/signup.html', '/reset-password.html',
  '/style.css', '/app.js', '/manifest.json',
  '/favicon.svg', '/icon-16.png', '/icon-32.png',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
  '/icon-192.svg', '/icon-512.svg'
];

// Install: cache each asset individually so one missing file
// does not abort the entire service-worker install.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(
        ASSETS.map(url =>
          cache.add(url).catch(() => {
            console.warn('[SW] Failed to pre-cache:', url);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// Activate: delete old caches and immediately take control.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for same-origin assets; for navigation
// requests fall back to cached /index.html so the app always
// opens instead of showing a 404 when offline or on a cold
// launch from the home screen.
self.addEventListener('fetch', e => {
  // Only handle GET requests from our own origin.
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request)
        .then(response => {
          // Cache successful responses for future use.
          if (response && response.status === 200 && response.type !== 'opaque') {
            caches.open(CACHE)
              .then(cache => cache.put(e.request, response.clone()))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => {
          // Network failed — for navigation requests serve the
          // shell so the app still opens rather than 404-ing.
          // If /index.html isn't cached yet, caches.match returns
          // undefined which the browser handles as a normal error.
          if (e.request.mode === 'navigate') {
            return caches.match('/index.html').then(r => r || caches.match('/'));
          }
        });
    })
  );
});

