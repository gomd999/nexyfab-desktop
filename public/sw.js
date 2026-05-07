// Kill-switch service worker.
//
// The previous SW ('nexyfab-v2') pre-cached '/' and intercepted all navigations,
// causing ERR_FAILED for returning visitors when the cached root went stale.
// This replacement installs, clears every cache, unregisters itself, and
// force-reloads any open tab so returning users heal automatically on next hit.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  // Pass every request straight through to the network while activate() is
  // still unregistering. No caching, no interception.
  event.respondWith(fetch(event.request));
});
