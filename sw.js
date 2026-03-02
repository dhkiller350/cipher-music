const CACHE = 'cipher-v2';
const ASSETS = [
  '/', '/index.html', '/style.css', '/app.js', '/manifest.json',
  '/favicon.svg', '/icon-16.png', '/icon-32.png',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
  '/icon-192.svg', '/icon-512.svg'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
