// Офлайн-оболочка. Сеть в приоритете (всегда свежая версия), кэш — на случай, если связи нет.
// Запросы к Supabase (другой адрес) и любые не-GET не кэшируются никогда.
const CACHE = 'dk-shell-v5';
const SHELL = ['./', 'index.html', 'logic.js', 'db.js', 'auth.js', 'api.js', 'xlsx-export.js', 'import-dishes.js', 'clean-logic.js', 'clean-store.js',
  'vendor/supabase.js', 'config.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match('index.html'); });
      })
  );
});
