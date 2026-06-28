const CACHE_NAME = 'coins-pwa-v22';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './data/issuers.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/issuers.js',
  './js/file-system.js',
  './js/currency.js',
  './js/ui.js',
  './js/drafts.js',
  './js/list.js',
  './js/detail.js',
  './js/form.js',
  './js/stats.js',
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

  const url = new URL(request.url);
  if (url.pathname.endsWith('/data/issuers.json')) {
    event.respondWith(
      fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  if (request.mode === 'navigate') {
    const legacyTarget = getLegacyRouteRedirect(url);
    if (legacyTarget) {
      event.respondWith(Response.redirect(legacyTarget, 302));
      return;
    }

    event.respondWith(
      caches.match('./index.html').then(cached => cached || fetch('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});

function getLegacyRouteRedirect(url) {
  const path = url.pathname;
  if (path.endsWith('/coin.html')) {
    const id = url.searchParams.get('id');
    return new URL(id ? './index.html#/coin/' + encodeURIComponent(id) : './index.html#/list', url).toString();
  }

  if (path.endsWith('/form.html')) {
    const id = url.searchParams.get('id');
    return new URL(id ? './index.html#/edit/' + encodeURIComponent(id) : './index.html#/new', url).toString();
  }

  if (path.endsWith('/stats.html')) {
    return new URL('./index.html#/stats', url).toString();
  }

  return '';
}
