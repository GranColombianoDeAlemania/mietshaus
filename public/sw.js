// Service worker of Mietshaus in the browser (also as an app on the iPhone home screen and in the Mac app): shows push
// notifications from the server, opens Mietshaus on a tap and keeps the page itself (no data) so that it also starts
// without a connection – the data then come from the answers kept for reading (src/offline.ts).
const OBERFLAECHE = 'mietshaus-oberflaeche-1';
const BILDER = ['/logo.svg', '/favicon.png', '/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== OBERFLAECHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || /^\/(api|dateien|kalender|mcp|lokal)(\/|$)/.test(u.pathname)) return;
  // Built files carry a hash in their name: once kept, always right.
  if (u.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(OBERFLAECHE).then(async (c) => (await c.match(e.request)) ?? fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  } else if (e.request.mode === 'navigate' || BILDER.includes(u.pathname)) {
    // The page and the icons: always fresh from the server, the kept copy only without a connection.
    const schluessel = e.request.mode === 'navigate' ? '/' : u.pathname;
    e.respondWith(fetch(e.request).then(async (r) => {
      if (r.ok) (await caches.open(OBERFLAECHE)).put(schluessel, r.clone());
      return r;
    }).catch(async () => (await caches.match(schluessel)) ?? Response.error()));
  }
});

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
