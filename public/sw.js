const CACHE_NAME = 'amiral-batti-v2';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Firebase ve API isteklerini cache'leme
  if (event.request.url.includes('firebase') || event.request.url.includes('googleapis')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ═══════════════════════════════════════════════════════════════
// BİLDİRİMLER
// ═══════════════════════════════════════════════════════════════

// Bildirime tıklanınca: oyun zaten açıksa o sekmeyi öne getir, değilse yeni aç.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client) { try { client.navigate(target); } catch (e) {} }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// Sunucudan gelen push (FCM/VAPID) için hazır dinleyici. Şu an sunucu tarafı yok;
// eklendiğinde uygulama tamamen kapalıyken de bildirim gelmeye başlar, burada
// değişiklik gerekmez. Beklenen gövde: { "title": "...", "body": "...", "tag": "..." }
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Amiral Battı';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || 'ab-push',
      renotify: true,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [40, 60, 40],
      data: { url: data.url || '/' },
    })
  );
});
