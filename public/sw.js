/**
 * Offline service worker: an installed game opens at once, with or without a
 * connection, and never to a blank page.
 *
 * Install keeps the whole build: the game's page (the "shell"), every file
 * Vite emitted under assets/ (PRECACHE: the scripts, the styles, the fonts,
 * stamped in at build time by vite.config.ts), the modelled cast and the
 * home-screen icons. Files are fetched one by one and a failing file never
 * fails the install, but the shell is only kept once every PRECACHE file is
 * cached beside it, so a kept shell always finds its own files.
 *
 * The game's page (the scope's root) races the network against a short
 * timer once a shell is cached: a sleeping server (Render's free tier wakes
 * in about a minute) or a slow or missing connection gets the cached game in
 * under three seconds, and the network's copy is kept for next time when it
 * arrives. A response that is not the game's page (a host's wake-up or error
 * page) is never shown in its place, nor kept. The very first visit has
 * nothing cached, so it waits for the network. A URL carrying ?cr-fresh asks
 * for the network's newest page (the "update needed" reload, see
 * src/app/offline.ts); it still falls back to the cached game.
 *
 * Every build has its own cache (cr-clone-<build id>). After a deploy the old
 * cache stays until nothing can need it: the new build's cache is complete
 * and every open page was served by this worker (a page from an older build
 * keeps loading its lazy files from its own cache). Files are looked up in
 * this build's cache first, then in any older one. At most OLD_KEPT older
 * builds wait on disk.
 *
 * Vite's hashed assets/ files are immutable and the models only change with
 * a build, so both are cache-first and never refetched. Anything else
 * same-origin (icons, the manifest) is cache-first with a background
 * refresh. The worker script itself is never cached or served from here.
 * src/app/sw.test.ts runs this file in a fake worker scope.
 */
const BUILD_ID = "__BUILD_ID__";
const CACHE = `cr-clone-${BUILD_ID}`;
/** Every cache this game ever names (other projects on a shared origin keep theirs). */
const OURS = "cr-clone-";
/** This build's assets/ files, scope-relative (stamped by vite.config.ts; empty in the source). */
const PRECACHE = /* __PRECACHE__ */ [];
const SCOPE = new URL(self.registration.scope);
/** An absolute URL for a scope-relative path (works under "/" and "/clash-royale-clone/"). */
const at = (path) => new URL(path, SCOPE).href;
const SHELL = at("./");
const ASSETS = new URL("assets/", SCOPE).pathname;
const MODELS = new URL("models/", SCOPE).pathname;
const WORKER = new URL("sw.js", SCOPE).pathname;
/** The cast pack, as src/render3d/cast/loader.ts loads it (src/app/sw.test.ts keeps the two in step). */
const CAST = ["anims", "barbarian", "knight", "mage", "rogue", "rogue_hooded", "skeleton_minion"].map(
  (f) => `models/troops/${f}.glb`,
);
/** What an installed icon needs to look right offline (index.html and the manifest link these). */
const APP_FILES = ["manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
/**
 * Only the game's own index.html holds this marker (a <meta name="cr-app-shell">
 * line; src/app/sw.test.ts checks it). It is a dedicated marker, not the
 * <title>, so renaming the game (or translating its title) never stops the
 * offline shell from being kept.
 */
const SHELL_MARK = 'name="cr-app-shell"';
/** How long the game's page waits for the network before the cached game is shown. */
const NAV_TIMEOUT_MS = 2500;
/** How long a ?cr-fresh page waits for the network before the cached game is shown. */
const FRESH_TIMEOUT_MS = 12000;
const FRESH_PARAM = "cr-fresh";
/** Older builds' caches kept at most, however long an old page stays open. */
const OLD_KEPT = 2;
/** What the page hears once this build is fully cached (src/app/offline.ts). */
const READY = "cr-offline-ready";
const ASK_READY = "cr-offline?";

const noop = () => undefined;
const wait = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

/** Windows (pages) this worker served a page to: they never need an older build's cache. Memory only. */
const served = new Set();

/** The page's HTML when `res` is the game's own page, else null (healthz, a wake-up or error page). */
async function gamePage(res) {
  if (!res || !res.ok || res.type === "opaqueredirect") return null;
  if (!(res.headers.get("content-type") || "").includes("text/html")) return null;
  try {
    const html = await res.clone().text();
    return html.includes(SHELL_MARK) ? html : null;
  } catch {
    return null;
  }
}

/** The assets/ files a page links to (its entry script, preloads and styles), scope-relative. */
function linkedAssets(html) {
  const out = [];
  for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const path = new URL(m[1], SCOPE).pathname;
    if (path.startsWith(ASSETS)) out.push(path.slice(SCOPE.pathname.length));
  }
  return out;
}

/** True when the page belongs to this build (another deploy's page links other files). */
const ownBuild = (html) => linkedAssets(html).every((path) => PRECACHE.includes(path));

/** Our caches other than this build's, oldest first. */
async function olderCaches() {
  return (await caches.keys()).filter((name) => name.startsWith(OURS) && name !== CACHE);
}

/** True once this build is fully cached (the shell is only ever kept then). */
async function isReady() {
  return Boolean(await (await caches.open(CACHE)).match(SHELL));
}

/**
 * Keep `html` as this build's offline shell, but only when it is this
 * build's page and every PRECACHE file is already in the cache beside it.
 */
async function keepShell(html) {
  if (!html || !ownBuild(html)) return false;
  const cache = await caches.open(CACHE);
  const hits = await Promise.all(PRECACHE.map((path) => cache.match(at(path))));
  if (!hits.every(Boolean)) return false;
  // A fresh, unredirected response (a redirected one cannot answer a navigation).
  await cache.put(SHELL, new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
  return true;
}

/** The game's page from the network, past the HTTP cache (install and top-up), or null. */
async function fetchShell() {
  return gamePage(await fetch(SHELL, { cache: "reload" }));
}

/**
 * The cached game to show: this build's page first, else the newest older
 * build's. A page is only shown from a cache that also holds the files it
 * links (its entry script, preloads and styles), so it can always start: a
 * cache from before precaching (or a damaged one) is passed over.
 */
async function cachedShell() {
  for (const name of [CACHE, ...(await olderCaches()).reverse()]) {
    const cache = await caches.open(name);
    const hit = await cache.match(SHELL);
    if (!hit) continue;
    const links = linkedAssets(await hit.clone().text());
    const found = await Promise.all(links.map((path) => cache.match(at(path))));
    if (found.every(Boolean)) return { res: hit, own: name === CACHE };
  }
  return null;
}

/** A file from this build's cache, else from an older build's (an old page's lazy files). */
async function lookup(req) {
  return (await (await caches.open(CACHE)).match(req)) || (await caches.match(req));
}

/** Tell open pages this build can now open offline. */
async function announce() {
  if (!(await isReady())) return;
  const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const page of pages) page.postMessage({ type: READY });
}

let topping = null;
/**
 * Finish an install that missed a file (a dropped connection, a host
 * mid-deploy): fetch what is missing and keep the shell once all is in.
 * Runs at most once at a time; the caller's event keeps the worker alive.
 */
function topUp() {
  topping ??= (async () => {
    if (await isReady()) return;
    const cache = await caches.open(CACHE);
    await Promise.all(
      PRECACHE.map(async (path) => (await cache.match(at(path))) || cache.add(at(path)).catch(noop)),
    );
    if (await keepShell(await fetchShell().catch(noop))) await announce();
  })()
    .catch(noop)
    .finally(() => (topping = null));
  return topping;
}

/**
 * Delete older builds' caches once nothing can need them: this build is fully
 * cached and every open page was served by this worker. However long an old
 * page stays open, only the newest OLD_KEPT older caches are kept.
 */
async function sweep() {
  const older = await olderCaches();
  if (!older.length) return;
  let drop = [];
  if (await isReady()) {
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (pages.every((page) => served.has(page.id))) drop = older;
  }
  if (!drop.length && older.length > OLD_KEPT) drop = older.slice(0, older.length - OLD_KEPT);
  await Promise.all(drop.map((name) => caches.delete(name)));
}

let tidiedAt = -Infinity;
/** Top up and sweep now and then (every fetch may ask; it runs at most every 10 s unless `now`). */
function tidy(event, now = false) {
  const t = Date.now();
  if (!now && t - tidiedAt < 10000) return;
  tidiedAt = t;
  event.waitUntil(topUp().then(sweep).catch(noop));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // The page first. No game page for this build (offline, a host's wake-up
      // or error page, a host mid-deploy) means no install: the worker in
      // charge keeps serving, and the browser tries again on a later launch.
      const html = await fetchShell();
      if (!html || !ownBuild(html)) throw new Error("no game page for this build");
      const cache = await caches.open(CACHE);
      // One file at a time, best effort: a file that fails to download must not
      // fail the install (the top-up fetches it later; until then the shell is
      // not kept, so an older build's complete cache still opens offline).
      await Promise.all([...PRECACHE, ...CAST, ...APP_FILES].map((path) => cache.add(at(path)).catch(noop)));
      await keepShell(html);
    })().then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim().then(sweep).then(announce).catch(noop));
});

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== ASK_READY) return;
  event.waitUntil(
    isReady().then((ready) => {
      if (ready && event.source) event.source.postMessage({ type: READY });
    }),
  );
});

/**
 * A navigation. The game's page races the network against a timer once a
 * shell is cached; any other page (/healthz, an old bookmark) is the
 * network's, with the cached game as the offline fallback.
 */
async function navigate(event, url) {
  const network = fetch(event.request);
  network.catch(noop); // settled below or in the background, never unhandled
  const id = event.resultingClientId;
  const appPage = url.pathname === SCOPE.pathname || url.pathname === `${SCOPE.pathname}index.html`;
  const cached = await cachedShell().catch(noop);
  if (!cached) {
    // The very first visit (nothing cached that can start): wait for the network, as ever.
    const res = await network;
    event.waitUntil(gamePage(res).then(keepShell).catch(noop));
    if (id) served.add(id);
    return res;
  }
  if (!appPage) {
    try {
      return await network;
    } catch {
      return cached.res;
    }
  }
  const fresh = url.searchParams.has(FRESH_PARAM);
  const first = await Promise.race([network.catch(noop), wait(fresh ? FRESH_TIMEOUT_MS : NAV_TIMEOUT_MS)]);
  const html = await gamePage(first);
  if (html) {
    // The network's game page, in time: shown, and kept if it is this build's.
    event.waitUntil(keepShell(html).catch(noop));
    if (id) served.add(id);
    return first;
  }
  // Slow, offline, or not the game (a wake-up or error page): the cached game
  // now, and the network's page kept for next time if it turns out to be ours.
  event.waitUntil(network.then(gamePage).then(keepShell).catch(noop));
  if (id && cached.own) served.add(id);
  return cached.res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The worker script itself: always the network's (an update must never come from a cache).
  if (url.pathname === WORKER) return;

  if (req.mode === "navigate") {
    event.respondWith(navigate(event, url));
    tidy(event, true);
    return;
  }
  tidy(event);

  if (url.pathname.startsWith(ASSETS) || url.pathname.startsWith(MODELS)) {
    // Hashed and immutable (assets), or fixed for a build (models): a cached
    // copy is always right and never refetched; a miss is fetched and kept.
    event.respondWith(
      lookup(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(noop);
            }
            return res;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    lookup(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(noop);
          }
          return res;
        })
        .catch(() => hit);
      return hit ?? refresh;
    }),
  );
});
