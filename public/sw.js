/**
 * Offline service worker: the app shell and every fetched asset are cached,
 * so an installed game launches (and plays solo) with no connection.
 *
 * Strategy: navigations are network-first (fresh deploys win) with a cache
 * fallback; everything else same-origin is cache-first with a background
 * refresh. Vite's hashed /assets/ files are immutable, so cache-first is
 * always correct for them.
 */
const CACHE = "cr-clone-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["./"])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // Network-first: a new deploy replaces the shell; offline falls back.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("./", copy));
          return res;
        })
        .catch(() => caches.match("./")),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit ?? refresh;
    }),
  );
});
