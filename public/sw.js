self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = String(data.title || "Constancce").trim();
  const options = {
    body: data.body || "Você tem algo importante para fazer.",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/favicon-32x32.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.renotify),
    data: {
      url: data.url || "/?view=notifications",
      taskId: data.taskId || null,
    },
    actions: data.taskId
      ? [
          { action: "complete", title: "Concluir" },
          { action: "snooze60", title: "Adiar 1h" },
        ]
      : [{ action: "open", title: "Abrir" }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const baseUrl = event.notification?.data?.url || "/?view=notifications";
  const taskId = event.notification?.data?.taskId || null;
  let targetUrl = baseUrl;

  if (taskId && event.action === "complete") {
    targetUrl = `/?view=tasks&completeTask=${encodeURIComponent(taskId)}`;
  } else if (taskId && event.action === "snooze60") {
    targetUrl = `/?view=tasks&snooze=60&task=${encodeURIComponent(taskId)}`;
  }

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });

    for (const client of windows) {
      if ("navigate" in client) {
        try { await client.navigate(targetUrl); } catch (_) {}
      }
      if ("focus" in client) return client.focus();
    }

    if (clients.openWindow) return clients.openWindow(targetUrl);
  })());
});


const CONSTANCCE_CACHE = "constancce-shell-v26";
const CONSTANCCE_SHELL = ["/", "/index.html", "/site.webmanifest", "/icon-192.png", "/icon-512.png", "/maskable-icon-512.png", "/apple-touch-icon.png", "/favicon.png", "/favicon-32x32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CONSTANCCE_CACHE)
      .then((cache) => cache.addAll(CONSTANCCE_SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("constancce-shell-") && key !== CONSTANCCE_CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CONSTANCCE_CACHE).then((cache) => cache.put("/index.html", clone)).catch(() => {});
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CONSTANCCE_CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
