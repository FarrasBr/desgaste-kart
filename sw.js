/* Service worker do Kart (Desgaste, Stints e Acerto).
   Guarda o app no aparelho para ele abrir sem internet.
   >>> Ao publicar uma nova versão dos arquivos, aumente VERSION (v1 -> v2 -> v3...). <<< */
var VERSION = 'v4';
var CACHE = 'desgaste-kart-' + VERSION;
var ASSETS = [
  './',
  'index.html',
  'acerto-modelo.js',
  'modulo-acerto.js',
  'firebase-config.js',
  'sync.js',
  'manifest.webmanifest',
  'vendor/firebase/firebase-app-compat.js',
  'vendor/firebase/firebase-auth-compat.js',
  'vendor/firebase/firebase-firestore-compat.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'fonts/barlow-latin-400-normal.woff2',
  'fonts/barlow-latin-500-normal.woff2',
  'fonts/barlow-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(ASSETS.map(function (url) {
        return fetch(new Request(url, { cache: 'reload' })).then(function (res) {
          if (!res.ok) throw new Error('Falha ao baixar ' + url);
          return cache.put(url, res);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys
        .filter(function (k) { return k.indexOf('desgaste-kart-') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Responde sempre pelo pacote da versão atual. Os arquivos só mudam todos juntos,
// quando VERSION aumenta; assim uma internet ruim nunca mistura versões diferentes.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (cached) {
        if (cached) return cached;
        return fetch(req).catch(function () {
          if (req.mode === 'navigate') return cache.match('index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        });
      });
    })
  );
});
