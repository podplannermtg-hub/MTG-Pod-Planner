// Pod Planner service worker: shows push notifications and opens the app when one is tapped.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'Pod Planner').slice(0, 120), {
    body: String(d.body || '').slice(0, 300),
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    tag: d.tag || undefined, renotify: !!d.tag,
    data: { url: d.url || '' }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  // Only ever open this app's own pages.
  var url = self.registration.scope + '#games';
  try { var u = new URL(e.notification.data && e.notification.data.url, self.registration.scope); if (u.href.indexOf(self.registration.scope) === 0) url = u.href; } catch (err) {}
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) { if (c.navigate) c.navigate(url).catch(function () {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
