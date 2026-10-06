// DDC Attendance PWA Service Worker  (v56 — robust install + reliable update)
// Caches only the static app shell. Never caches Supabase / API / geolocation
// data, so attendance punches and geofence checks always hit the network live.

const CACHE_NAME = 'staffly-shell-v56';

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
  '/assets/dev-anime.jpg'
];

// Install: pre-cache the app shell.
// IMPORTANT: cache each asset individually so one missing file does NOT
// kill the entire install (addAll is all-or-nothing).  Previously, a
// single 404 on any shell asset would silently fail the whole SW
// install, leaving the Update banner showing forever with no way out.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Could not cache', url, err);
            return null; // swallow — don't fail the whole install
          })
        )
      )
    )
  );
});

// Let the page tell a waiting worker to activate immediately
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activate: clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for the app shell, network-only for everything dynamic
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

  if (isDynamic) {
    return;
  }

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
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});

// PUSH NOTIFICATIONS
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Staffly', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.find((c) => c.visibilityState === 'visible');
    if (visible) {
      visible.postMessage({ type: 'staffly-push', data });
      return;
    }
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
