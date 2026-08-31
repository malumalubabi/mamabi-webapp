// PWA installability + light offline resilience - deliberately NOT a heavy
// offline-first cache. This app is constantly reading/writing live business
// data (orders, stock, cashflow) via /api/*, so those requests are always
// network-only, never cached. Only the static app shell (index.html,
// shared.css/js, pages/*.js, icons) gets cached, and network-first even
// there - a cached copy is only ever served when the network request
// actually fails (offline), so a normal online visit always gets the
// current deployed version, never a stale service-worker cache.
const CACHE_NAME = "malumalubabi-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
