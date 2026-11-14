/* Service worker : met l'application en cache pour jouer hors ligne.
   Les fichiers sont toujours revalidés auprès du serveur (cache: 'no-cache') : le cache HTTP du navigateur (GitHub Pages : 10 min) ne peut plus
   mélanger un vieux index.html avec un nouvel app.js. Les scripts portent en plus ?v=N (index.html), à changer avec CACHE à chaque livraison. */
var CACHE = 'cinqrois-v11';
var FILES = ['./', './index.html', './engine.js?v=11', './en-ligne.js?v=11', './app.js?v=11', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(FILES.map(function (u) { return c.add(new Request(u, { cache: 'reload' })); }));   // jamais depuis le cache HTTP
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;   // Supabase : jamais via le cache (une coupure réseau doit rester visible)
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match('./index.html'); }); })
  );
});
