// DDC Attendance PWA Service Worker
// Caches only the static app shell. Never caches Supabase / API / geolocation
// data, so attendance punches and geofence checks always hit the network live.

const CACHE_NAME = 'staffly-shell-v45';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/pages.js',
  '/sounds/staffly.mp3',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-96x96.png',
  '/default-avatar.svg',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png'
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  // NOTE: intentionally no self.skipWaiting() here.
  // We want the new worker to sit in "waiting" state until the user
  // explicitly taps "Update Now" in the app's update banner.
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

  // Never touch non-GET requests, cross-origin API calls, or Supabase traffic.
  const isDynamic =
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.hostname.includes('supabase') ||
    url.pathname.includes('/rest/') ||
    url.pathname.includes('/auth/') ||
    url.pathname.includes('/storage/');

  if (isDynamic) {
    // Let it go straight to the network, no caching, no interception logic.
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          // Cache a copy of newly-fetched shell assets for next time offline.
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() => {
          // Offline fallback: serve the cached shell page if available.
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});

// ==========================================================================
// PUSH NOTIFICATIONS
// ==========================================================================
// Sent by the "staffly-push" Edge Function. If Staffly is open and visible,
// the page shows it itself (bell + "Staffly!" jingle) - no duplicate system
// alert. Otherwise it appears on the lock screen / notification bar.
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

// Tapping the alert opens Staffly on the right page.
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