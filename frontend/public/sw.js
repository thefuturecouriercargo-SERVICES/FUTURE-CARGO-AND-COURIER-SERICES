/* Future Courier service worker — Azan push notifications for drivers. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "🕌 നിസ്കാര സമയം", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "🕌 നിസ്കാര സമയം", {
      body: data.body || "",
      icon: "/fc-icon-192.png",
      badge: "/fc-icon-192.png",
      tag: data.tag || "azan",
      renotify: true,
      requireInteraction: true,
      vibrate: [500, 250, 500, 250, 500],
      data: { url: data.url || "/driver" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/driver";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes("/driver") && "focus" in w) {
          w.navigate(url).catch(() => undefined);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
