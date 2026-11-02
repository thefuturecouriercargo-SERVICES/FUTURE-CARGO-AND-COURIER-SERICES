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

/* Offline screen — needed so the app can be packaged as an Android APK.
   Only full page loads are handled; API calls, live updates and uploads pass
   straight through. Nothing is cached, so drivers always see live data. */
const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — Future Courier</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;text-align:center;padding:24px}
h1{color:#d4af37;font-size:22px;margin:0 0 8px}p{opacity:.8;margin:0 0 20px}
button{background:#d4af37;color:#0f172a;border:0;border-radius:10px;padding:12px 22px;font-weight:700;font-size:15px}</style>
</head><body><div><h1>You're offline</h1><p>Check your internet connection and try again.</p>
<button onclick="location.reload()">Retry</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    )
  );
});
