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
 *
 * The modelled cast (public/models/troops, about 0.8 MB of CC0 KayKit
 * characters and clips) is precached on install, per build, so an installed
 * game fields the cast offline and a fresh launch never waits on it. Model
 * files only change with a build, so they are cache-first with no background
 * refetch (a phone does not pull 0.8 MB again on every launch).
 */
const BUILD_ID = "__BUILD_ID__";
const CACHE = `cr-clone-${BUILD_ID}`;
const ASSETS = new URL("assets/", self.registration.scope).pathname;
const MODELS = new URL("models/", self.registration.scope).pathname;
/** The cast pack, as src/render3d/cast/loader.ts loads it (src/app/sw.test.ts keeps the two in step). */
const CAST = ["anims", "barbarian", "knight", "mage", "rogue", "rogue_hooded", "skeleton_minion"].map(
  (f) => `models/troops/${f}.glb`,
);
/** Only the game's own index.html holds this (src/app/sw.test.ts checks it). */
const SHELL_MARK = "<title>Clash Royale Clone</title>";

/**
 * Keep a navigation response as the offline shell only when it is the game's
 * page. The server that hands out the game also answers /healthz (JSON), and
 * a sleeping host may answer with its own wake-up page or an error page:
 * caching any of those would show it instead of the game when offline.
 */
function keepShell(res) {
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return Promise.resolve();
  const probe = res.clone();
  const copy = res.clone();
  return probe
    .text()
    .then((html) => (html.includes(SHELL_MARK) ? caches.open(CACHE).then((cache) => cache.put("./", copy)) : undefined))
    .catch(() => undefined);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(["./"]).then(() =>
          // Best effort, one file at a time: a model that fails to download
          // must not fail the install (the game falls back to its procedural
          // roster, and the file is cached on its next successful fetch).
          Promise.all(CAST.map((path) => cache.add(path).catch(() => undefined))),
        ),
      )
      .then(() => self.skipWaiting()),
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
          keepShell(res);
          return res;
        })
        .catch(() => caches.match("./")),
    );
    return;
  }

  if (url.pathname.startsWith(ASSETS) || url.pathname.startsWith(MODELS)) {
    // Hashed and immutable (assets), or fixed for this build (models, and the
    // cache is per build): the cached copy is always right, never refetched.
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
