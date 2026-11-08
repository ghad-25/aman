/* AMAN service worker: shows doctor notifications and opens the alerts screen when tapped. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'أمان', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'أمان';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/assets/icon-192.png',
    badge: '/assets/badge-96.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    dir: 'rtl',
    lang: 'ar',
    data: { url: data.url || '/doctor/dashboard#alerts' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/doctor/dashboard#alerts';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/doctor/dashboard')) { await c.focus(); c.postMessage({ type: 'open-alerts' }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
