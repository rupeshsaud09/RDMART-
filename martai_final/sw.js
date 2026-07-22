// KHATA PANA service worker — offline app shell + cached assets.
// Bump CACHE version when deploying big changes to force a refresh.
const CACHE = 'martai-v48';
const SHELL = [
  'index.html',
  'customer.html',
  'dashboard.html',
  'staff.html',
  'assets/martai.css?v=18',
  'assets/staff.css?v=3',
  'assets/login-experience.css?v=4',
  'assets/martai-date.js?v=1',
  'assets/martai-ui.js?v=1',
  'assets/martai-store.js?v=29',
  'assets/martai-cheques.js?v=1',
  'assets/martai-intelligence.js?v=1',
  'assets/martai-ai-client.js?v=1',
  'assets/martai-insights-ui.js?v=1',
  'assets/khata-backup.js?v=5',
  'assets/martai-bot.js?v=5',
  'assets/martai-qr.js',
  'assets/martai-supabase-config.js',
  'assets/martai-push-config.js',
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

// Daily-summary push notification: shows a plain local notification from
// the small JSON payload the server sends. Never contains secrets — only
// display text and a page to open, so a lost/stolen phone learns nothing
// that a glance at the shop wouldn't already show.
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = {}; }
  const title = String(data.title || 'RD MART — Daily summary').slice(0, 120);
  const options = {
    body: String(data.body || '').slice(0, 500),
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    tag: String(data.tag || 'martai-daily-summary').slice(0, 80),
    data: { url: String(data.url || 'dashboard.html').slice(0, 200) }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || 'dashboard.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : null;
    })
  );
});
