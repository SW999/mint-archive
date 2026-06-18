const CACHE_NAME = 'coins-pwa-v6';
const APP_SHELL = [
  './',
  './index.html',
  './coin.html',
  './form.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/file-system.js',
  './js/currency.js',
  './js/ui.js',
  './js/drafts.js',
  './js/list.js',
  './js/detail.js',
  './js/form.js',
  './images/icon.svg',
  './images/placeholder-obverse.svg',
  './images/placeholder-reverse.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});
