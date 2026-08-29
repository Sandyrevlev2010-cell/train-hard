/* Train Hard MVP — service worker.
 * Кэш-первый для статики приложения, сеть-первый для документа.
 * Кэшируется ТОЛЬКО same-origin. URL с query-параметрами (возврат из
 * оплаты и служебные метки) не кэшируются никогда. Никаких секретов
 * и персональных данных в кэше нет: приложение хранит их только в
 * localStorage, который SW не перехватывает. */
var CACHE = 'trainhard-mvp-v5';
var ASSETS = [
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  /* очистка старых версий кэша — защита от устаревших/отравленных копий */
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;          /* платёжная страница и внешние ресурсы не перехватываем */
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  if (url.search) {                                     /* любой URL с параметрами (в т.ч. ?th_pay=return) — только сеть */
    e.respondWith(fetch(req).catch(function () { return caches.match('./'); }));
    return;
  }

  if (req.mode === 'navigate') {
    /* документ: сеть-первый (обновления применяются сразу), офлайн — из кэша */
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('./'); }); })
    );
    return;
  }

  /* остальное (иконки, манифест): кэш-первый */
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
    })
  );
});
