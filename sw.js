'use strict';
const PREFIX = 'little-songs-test-shell:' + new URL(self.registration.scope).pathname + ':';
const CACHE = PREFIX + 'v6';
const SHELL = ["./","./index.html","./assets/style-cdeb427e528c.css","./assets/backup-d12f33d51bce.js","./assets/app-a239a418864c.js","./manifest.webmanifest","./songs.json","./icons/icon-192.png","./icons/icon-512.png","./icons/apple-touch-icon.png"];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request; const url = new URL(request.url); const base = new URL(self.registration.scope);
  if (request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  const relative = url.pathname.slice(base.pathname.length);
  // Audio blobs are saved explicitly by the app in IndexedDB. Never cache partial audio responses.
  if (relative.startsWith('songs/') || request.headers.has('range')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match(new URL('./index.html',base).href))); return;
  }
  if (relative === 'songs.json') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try { const response = await fetch(request); if (response.ok) await cache.put(request,response.clone()); return response; }
      catch(error) { const cached = await cache.match(request,{ignoreSearch:true}); if (cached) return cached; throw error; }
    })()); return;
  }
  if (SHELL.some(path => new URL(path,base).pathname === url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(request,{ignoreSearch:true})) || fetch(request)));
  }
});
