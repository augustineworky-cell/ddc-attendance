// DDC Attendance PWA Service Worker  (v58 — client logos added, silent update)
// Caches only the static app shell. Updates install, activate and reload
// the page automatically — no "Update Now" prompt is ever shown.

const CACHE_NAME = 'staffly-shell-v58';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/pages.js',
  '/sounds/staffly-soft.mp3',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-96x96.png',
  '/default-avatar.svg',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  '/assets/dev-real.jpg',
  '/assets/dev-anime.jpg',
  '/assets/clients/makemyclick.jpg',
  '/assets/clients/zenin.jpg',
  '/assets/clients/bansals.jpg',
  '/assets/clients/catalyster.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      SHELL_ASSETS.map((url) =>
        cache.add(url).catch((err) => {
          console.warn('[SW] Could not cache', url, err);
          return null;
        })
      )
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  const isDynamic =
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.hostname.includes('supabase') ||
    url.pathname.includes('/rest/') ||
    url.pathname.includes('/auth/') ||
    url.pathname.includes('/storage/');

  if (isDynamic) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() => {
          if (request.mode === 'navigate') return caches.match('/index.html');
        });
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: 'Staffly', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.find((c) => c.visibilityState === 'visible');
    if (visible) { visible.postMessage({ type: 'staffly-push', data }); return; }
    await self.registration.showNotification(data.title || 'Staffly', {
      body: data.body || '',
      tag: data.tag || undefined,
      icon: '/icon-192.png',
      badge: '/favicon-96x96.png',
      vibrate: [60, 40, 90],
      data: { url: data.url || '/' }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        c.postMessage({ type: 'staffly-open', url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
