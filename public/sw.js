// Service worker of Mietshaus in the browser (also as an app on the iPhone home screen): shows push notifications from
// the server and opens Mietshaus on a tap. It caches nothing – Mietshaus always works with the live server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let n = { titel: 'Mietshaus', text: '', url: '/' };
  try { n = { ...n, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(n.titel, { body: n.text, icon: '/icon-192.png', badge: '/icon-192.png', tag: n.art, data: { url: n.url } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url ?? '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
    const offen = fenster.find((f) => f.url.startsWith(self.location.origin));
    if (offen) { offen.focus(); return offen.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  }));
});
