/* Acacia Books - lets the browser install Books as an app. Pages always come from the network when online;
   a saved copy is only used if the connection fails. Cross-origin requests (Supabase, CDNs) are never touched. */
var V = 'acx-books-v1';
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x.indexOf('acx-books-') === 0 && x !== V; }).map(function (x) { return caches.delete(x); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request; if (r.method !== 'GET') return;
  var u = new URL(r.url); if (u.origin !== self.location.origin) return;
  e.respondWith(fetch(r).catch(function () { return caches.match(r).then(function (m) { return m || caches.match('index.html'); }); }));
});
