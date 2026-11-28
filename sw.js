const CACHE = 'health-tracker-v8';
const ASSETS = ['./', 'index.html', 'styles.css?v=8', 'app.js?v=8', 'foods.json', 'peptides.json', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network-first for the page and scripts so a phone never mixes an old index.html with a new app.js.
// Icons stay cache-first.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const path = new URL(req.url).pathname;
  const base = path.slice(path.lastIndexOf('/') + 1) || 'index.html';
  const networkFirst = req.mode === 'navigate' || base === 'index.html' || base === 'app.js' || base === 'styles.css' || base === 'foods.json' || base === 'peptides.json' || base === 'sw.js';
  if (networkFirst) {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then(c => { c.put(req, copy); if (base === 'index.html' || req.mode === 'navigate') c.put('index.html', r.clone()); });
      }
      return r;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
