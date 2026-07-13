// RD MART service worker — offline app shell + cached assets.
// Bump CACHE version when deploying big changes to force a refresh.
const CACHE = 'martai-v20';
const SHELL = [
  'index.html',
  'customer.html',
  'dashboard.html',
  'assets/martai.css',
  'assets/martai-store.js',
  'assets/martai-bot.js',
  'assets/martai-qr.js',
  'assets/martai-supabase-config.js',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never touch the database API (data must always be live; offline writes
  // are handled by the app's own pending-sync queue in localStorage).
  if (url.hostname.includes('supabase')) return;

  // Pages: network first so deploys show up immediately; cache when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))
      )
    );
    return;
  }

  // Assets + CDN (supabase-js script, fonts): stale-while-revalidate.
  e.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
