# Offline and boot: opens every time, never a blank page

Round 2 package `boot` (enhancement plan 2026-11, "Opens every time, keeps
every trophy"): all of **C41** (the installed game opens at once and works
offline) and the boot half of **C43** (a splash that waits, a late-loading
line, a "Tap to try again", and a kid-friendly no-WebGL screen). No battle
sim or online protocol change: `src/game` is untouched, SIM_VERSION and
PROTOCOL_VERSION stay 3. Nothing is sent anywhere: the worker and the boot
script only ever talk to the game's own origin.

## What was wrong

- The worker registered on window `load`, after the scripts, styles and
  fonts had already been fetched without it, so they were cached only on a
  second online launch. After every deploy the new worker's `activate`
  deleted the old cache, so the files went uncached again. A kid opening the
  icon offline got the cached page, a 10 s splash, then a blank navy page.
- Navigations were network-first with no timeout: when Render was asleep
  (about a minute to wake after 15 idle minutes) an installed, fully cached
  game waited behind Render's wake-up.
- The online "New version - reload" button called `location.reload()`, which
  could land on the same stale cached page.
- The boot splash faded out blindly at 10.3 s, ready or not; on a slow
  tablet the kid then stared at an empty page.
- With 3D graphics switched off, the game showed an English-only technical
  note (`chrome://settings/system`), even in the Golden Age edition.

## What changed

### The worker installs the whole build (`public/sw.js`, `vite.config.ts`, `src/app/swStamp.ts`)

- The build's `sw-stamp` plugin (it already stamped the build id) now also
  writes **PRECACHE**: every file Vite emitted under `assets/` (the JS
  chunks, the CSS, the fonts), as scope-relative paths (`assets/index-…js`),
  so one list works under `/` (Render) and `/clash-royale-clone/` (GitHub
  Pages). It is taken from Rollup's output bundle, sorted, source maps left
  out, and the build **fails** if any file on disk in `dist/assets` is
  missing from it. `buildId()` is computed once at module level (`BUILD_ID`)
  so the "shield" package's `define` can share it.
- Install fetches the game's page first (`cache: "reload"`). No game page
  for this build (offline, a wake-up or error page, a host mid-deploy) means
  no install: the worker in charge keeps serving and the browser tries again
  later. Then every PRECACHE file, the 7 cast models and the home-screen
  files (manifest and icons) are cached one by one, best effort: one failing
  file never fails the install. The page is only kept as this build's
  offline "shell" once every PRECACHE file is in the cache beside it, so a
  kept shell always finds its own files. A later fetch tops up anything the
  install missed and then keeps the shell.
- `sw.js` itself is never cached or answered by the worker (the server
  already sends it `no-cache`).

### Never wait on a sleeping server

- The game's page (the scope root, or `index.html`) races the network
  against a **2.5 s** timer once a usable cached shell exists. If the timer
  wins, or the answer is not the game (not ok, not `text/html`, or no
  `cr-app-shell` marker: Render's wake-up page, an error page), the cached
  game is shown and the network's answer is kept in the background if it
  turns out to be this build's game page. A wake-up page is never shown in
  the game's place and never kept.
- The very first visit (nothing usable cached) waits for the network, as
  before. Other pages (`/healthz`, an old bookmark) are the network's, with
  the cached game as the offline fallback.

### A cached page always finds its own files (upgrade safety)

- Every build keeps its own cache (`cr-clone-<build id>`), and the old one
  is **no longer deleted on activate**. Older caches go once nothing can need
  them: this build is fully cached and every open page was served by this
  worker. At most two older builds wait on disk, however long an old page
  stays open. Caches that are not the game's (`cr-clone-` prefix) are never
  touched.
- Files are looked up in this build's cache first, then in any older one, so
  a page from the previous build (served while a new worker activates, or
  still open when it takes over) keeps loading its lazy chunks.
- The cached game to show is this build's shell, else the newest older
  build's, and only from a cache that also holds the files that page links
  (entry script, preloads, styles). A cache from before precaching (the live
  worker's, which may hold a shell without its scripts) is passed over.

### "New version - reload" lands on the newest game (`src/app/offline.ts`)

- `reloadToNewest()` asks the registration for an update, gives a new worker
  up to ~10 s to take over (a "Getting the newest game…" toast if it takes a
  moment), then reloads with a one-shot `?cr-fresh=<t>` mark. The worker
  answers that one navigation with the network's newest page (waiting up to
  12 s instead of 2.5 s), still falling back to the cached game offline.
  The page takes the mark back off the address at boot. It never throws and
  never hangs: whatever happens, it reloads. The lobby's Reload button just
  calls it.
- Once per device, after the worker reports the whole build cached and the
  game is on screen, a toast says "Ready to play offline!" /
  "اللعبة جاهزة للعب بلا إنترنت!" (`cr-clone-offline-ready-seen`).

### The splash that waits (`index.html`)

- The blind `bootOut 0.3s 10s` fade and the window-`load` trigger are gone:
  the splash stays until the game's first frame (`body.booted`, added by
  `main.ts`) and vanishes the moment the game is ready.
- A small inline script (plain old JavaScript, it runs before the game's
  modules; `src/app/bootSplash.test.ts` runs it against a fake document):
  - after **12 s**, a calm line fades in under the bar: "Still loading…
    nearly there!" / "ما زالت اللعبة تُحمَّل… اقتربنا!";
  - on a boot error (an uncaught error, a script or stylesheet or module
    preload that failed to load, a dynamic import that failed) before
    `booted`, or after **45 s**, a big "Tap to try again" / "اضغط لتحاول
    مجددًا" button that reloads with `?cr-fresh` (on an error the whole
    splash is tappable and the bar stops);
  - the words follow the saved edition (`cr-clone-arena-theme` =
    `arabic`): Arabic, `dir="rtl"` on the splash text only; the title reads
    هجمة التاج there;
  - `prefers-reduced-motion` keeps the bar still and the line appears
    without a fade.
- Images and fonts failing is not a boot error. The portrait studio
  (`?gallery=`) still steps the splash aside.

### No 3D in this browser (`src/app/noWebgl.ts`)

- When the 3D scene cannot start, `main.ts` shows a friendly card in the
  edition's language (through `tr()`), then still throws so the boot stops:
  - "Oops! The 3D is switched off" / "عذرًا! الرسوم المجسَّمة مُطفأة"
  - kid line: "This game needs 3D graphics, and they are switched off in
    this browser." and "Ask a grown-up to help you turn them on."
  - "For grown-ups": turn on hardware acceleration ("Use graphics
    acceleration when available") in the browser settings and restart it,
    or open the game in another browser;
  - a Try again button (reload).
- The card covers the page and takes the splash down (`body.booted`), so
  the splash never hides it and its watcher ignores the throw.

## Precache size

Measured on this branch's production build (`npm run build:all`):

| What | Files | On disk | Over the wire |
| --- | ---: | ---: | ---: |
| `assets/` (PRECACHE: 7 JS chunks, 1 CSS, 6 fonts) | 13 | 2.06 MB | about 0.70 MB (JS and CSS compressed, fonts as they are) |
| Cast models (`models/troops/*.glb`) | 7 | 0.81 MB | 0.81 MB (already cached before this change) |
| Shell, manifest, 3 icons | 5 | about 0.06 MB | small |
| **Cache for one build** | **25** | **about 2.9 MB** | **about 1.6 MB** |

The biggest are `index-*.js` (0.98 MB, 0.34 MB compressed) and
`three-*.js` (0.62 MB, 0.16 MB compressed). The install happens after the
page's own load, so most of the scripts, styles and fonts come out of the
browser's HTTP cache rather than downloading twice; on a first visit the
extra download is mainly the font files the browser did not pick (the
`.woff` twins, the other edition's face) and the lazy chunks. Each deploy
installs its build once; old builds' caches are removed as described
above, so about one build (plus at most two waiting old ones while an old
page stays open) is ever on disk.

## How to test

In a production build only (the worker never registers in dev):

```
npm run build:all
PORT=3110 NODE_ENV=production node dist-server/relay.mjs
```

Open http://localhost:3110/ in Chrome, then DevTools > Application.

- **Precache.** Service workers: one active `sw.js`. Cache Storage:
  `cr-clone-<build id>` with `/`, every file in `dist/assets`, the 7
  models, the manifest and the 3 icons (25 entries). The first time this
  completes the game shows "Ready to play offline!" once.
- **Offline.** Stop the server and reload (or close the tab and open the
  game again): the game opens and a bot battle plays.
- **A sleeping server.** Put something in front of the server that holds
  requests for a minute, or answers every request with a plain HTML "waking
  up" page (Render's wake-up page). With the game installed, reload: the
  game is on screen about 2.5 s after the tap (held) or at once (wake-up
  page), and the wake-up page never appears or lands in Cache Storage.
- **Upgrade.** Build twice (each build gets a new id), serve the first,
  let it install, serve the second, open the game a few times: every launch
  opens, the second build takes over within a launch or two (Chrome checks
  for a new worker a few seconds after a page opens), and the first
  build's cache goes once no page from it is open.
- **Update needed.** The lobby's Reload button (shown when the relay
  answers `update-required`) lands on the server's newest build.
- **Splash.** DevTools > Performance: CPU 4x slowdown, Network: Slow 3G, a
  first visit (Application > Storage > Clear site data): the splash stays
  until the game appears, with "Still loading… nearly there!" after 12 s.
  Block the `index-*.js` request (Network > right-click > Block request
  URL): "Tap to try again" at once; unblock and tap it to get the game.
- **No 3D.** chrome://settings/system, turn off "Use graphics acceleration
  when available", relaunch Chrome (or start it with `--disable-gpu
  --disable-software-rasterizer`).

## Verified

Production builds, headless Chromium (SwiftShader), real touch on a
390x844 phone and mouse on a 1440x900 desktop, both editions. Each
"launch" below is a fresh browser process on a kept profile, as when a kid
taps the icon again. Servers: the relay (`dist-server/relay.mjs`), a small
front proxy that could pass, hold (70 s), answer a "waking up" page or drop
everything, and for GitHub Pages a static server under
`/clash-royale-clone/`.

- **(a) Precache.** After the first online visit and the worker's
  activation, Cache Storage held all 13 `dist/assets` files (none missing),
  plus `/`, the 7 models, the manifest and 3 icons: 25 entries, at `/` and
  under `/clash-royale-clone/` alike. "Ready to play offline!" /
  "اللعبة جاهزة للعب بلا إنترنت!" showed once.
- **(b) Offline relaunch.** With every connection dropped: Home in about
  2 s from the page start, a bot battle started and two cards deployed by
  real drag (phone) and click (desktop), in both editions and on the Pages
  path; no page errors, no failed requests.
- **(c) Sleeping server.** Installed game, every request held 70 s: the
  page arrived at 2.5 s and the game was booted at 4.4-5.0 s (about 2-2.5 s
  of boot on SwiftShader after the page arrives, as in a normal launch).
  Every request answered with a "waking up" HTML page: the cached game at
  once; the wake-up page was never shown, and the cached shell still held
  the game's page afterwards.
- **(d) Upgrade safety, 16 launches on one device:** the live build
  (d5fda1d, its own old worker) for two launches; then this branch (NEW):
  the first launch opened NEW from the network through the old worker, the
  NEW worker took over about 10 s later, the old cache was gone on the next
  launch, and an offline launch opened NEW. Then NEWER was deployed while
  the host was asleep (70 s holds): the launch opened the cached NEW game
  at 2.5 s; when the host woke, the NEWER worker installed and took over
  that open NEW page, which then played a whole bot battle start with two
  deploys (its files came from NEW's cache, kept while that page was open);
  the next launch was NEWER and NEW's cache was gone; offline opened NEWER.
  Then NEWEST was deployed and its install lost a file to a dropped
  connection: its worker took charge without keeping a shell, an offline
  launch opened the complete NEWER game, the next online launch topped
  NEWEST up and NEWER's cache went, and NEWEST opened offline. No launch
  was blank, no page error, no failed request.
- **(e) Update needed.** NEW installed, NEWER deployed, a launch served the
  cached NEW page (host held 70 s, and again with a 4 s slow host), the kid
  opened a friend's invite link and the relay answered `update-required`
  (faked in the browser, since the protocol is not bumped): "New version -
  reload"; tapping Reload showed "Getting the newest game…" and landed on
  NEWER in 2-3 s, in both editions, and the next launch stayed on NEWER.
- **(f) Splash.** CPU 4x and Slow 3G, first visit: splash from 2.5 s,
  "Still loading… nearly there!" at 14 s (12 s after the boot script ran),
  game ready at 22-26 s with the splash gone at once; Arabic text, right to
  left, in the Golden Age edition. The game's entry script failing to load:
  "Tap to try again" within 0.6 s, and tapping it (fault cleared) reloaded
  into the game. The entry script never arriving: the line at 12 s and the
  button at 45 s. With reduced motion the bar stands still and the line
  has no fade.
- **(g) No WebGL** (`getContext("webgl2"/"webgl")` returning null): the
  card in both editions on phone and desktop, splash gone, no horizontal
  scroll, 16 px gutters on the phone; boot stopped with "WebGL
  unavailable".

Not covered: a real iPhone or Android device, Safari and Firefox (their
service workers follow the same standard, but update timing differs), and
a real Render cold start (simulated by the proxy).

## Keys

- `cr-clone-offline-ready-seen`: the "Ready to play offline!" toast was
  shown on this device. No other new keys.
