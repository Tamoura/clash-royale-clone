/**
 * Offline service worker: the app shell and every fetched asset are cached,
 * so an installed game launches (and plays solo) with no connection.
 *
 * Strategy: navigations (index.html) are network-first so a new deploy wins,
 * with the cached shell as the offline fallback. Vite's hashed /assets/ files
 * are immutable, so they are cache-first and never refetched in the
 * background. Anything else same-origin (icons, the manifest) is cache-first
 * with a background refresh.
 *
 * The cache name carries a build id stamped in at build time (see
 * vite.config.ts), so every deploy starts a fresh cache and activate deletes
 * the old ones: no stale assets pile up across releases.
 */
const BUILD_ID = "__BUILD_ID__";
const CACHE = `cr-clone-${BUILD_ID}`;
const ASSETS = new URL("assets/", self.registration.scope).pathname;

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

  if (url.pathname.startsWith(ASSETS)) {
    // Hashed and immutable: the cached copy is always right, never refetched.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
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
