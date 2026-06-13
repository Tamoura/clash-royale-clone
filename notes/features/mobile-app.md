# Mobile app — plan (not yet built)

Decision captured: **write the plan now, build later.** This is the design we'll
follow when the user gives the go-ahead. Nothing here is implemented yet.

## Why mobile is close already
- The game renders to a single `<canvas>` in a portrait 9:16 layout
  (`#app { width: min(100vw, 52vh) }`) — already phone-shaped.
- Controls are tap/drag to deploy (pointer events) — already touch-first.
- Online 1v1 uses a thin relay that forwards only deploy commands, not game
  state (see [[online-1v1]]) — light enough for phones on Wi-Fi.

So "mobile" is mostly **packaging** + **making online play work over the
internet**, not a rewrite.

## The three layers (each shippable on its own)

### 1. PWA shell — installable web app (days, free, no accounts)
Goal: "Add to Home Screen" installs it; launches fullscreen like an app; solo
play works offline.
- `public/manifest.webmanifest`: name, theme/background `#1b2433`, `display:
  standalone`, `orientation: portrait`, icon set (192/512 + maskable).
- App icons (reuse the in-game art style; generate 192/512/maskable + Apple
  touch icon).
- `<link rel="manifest">`, `<meta name="apple-mobile-web-app-*">`,
  `theme-color` in `index.html`.
- Service worker (use `vite-plugin-pwa`, Workbox under the hood):
  precache the built JS/CSS/HTML so solo play works offline. Network-first for
  the relay socket (it's a live connection, never cached).
- iOS gotchas: audio still needs a user gesture (already handled via
  `audio.resume()` on first pointerdown); add safe-area insets
  (`env(safe-area-inset-*)`) so the HUD clears the notch/home bar.
- Acceptance: installs to home screen on iOS Safari + Android Chrome, runs
  fullscreen portrait, solo plays with no network.

### 2. Internet play — hosted relay (small, well-scoped)
LAN works today; for kids in different houses the relay must be reachable
online. The architecture already supports it.
- **Client:** make the relay URL configurable instead of hardcoded
  `ws://${location.hostname}:3110` (in `main.ts: connectRoom`). Read from a
  build-time env (`import.meta.env.VITE_RELAY_URL`) with the LAN value as the
  fallback. Use `wss://` in production (secure WebSocket).
- **Server:** deploy `server/relay.ts` to a small always-on host (Fly.io or
  Render free tier). It's stateless except for in-memory rooms, so a single
  tiny instance is plenty for family use. Add a `/healthz` ping and a room TTL
  so abandoned rooms get garbage-collected.
- **Security/abuse:** codes are short — fine for friends, but a public relay
  should rate-limit `create`, cap concurrent rooms, and expire codes. Keep it
  minimal; this is family-scale.
- Acceptance: two phones on cellular/different Wi-Fi can create+join a code and
  play a full match in sync (the lockstep + checksum already guarantee
  fairness; just needs reachability).

### 3. Native store apps — Capacitor (1–2 weeks + developer accounts)
Only if App Store / Play Store presence is wanted. No game rewrite — Capacitor
wraps the existing Vite build in a native WebView shell.
- `npm i @capacitor/core @capacitor/cli`; `npx cap init`; add `ios` + `android`
  platforms; `webDir` = `dist`; `npx cap copy` after each `npm run build`.
- Lock orientation to portrait; set the splash + adaptive icons.
- Nice-to-haves via Capacitor plugins: Haptics (buzz on deploy/crown),
  StatusBar styling, KeepAwake during a match.
- Distribution: Apple Developer Program ($99/yr) + TestFlight for the kids;
  Google Play ($25 one-time) + internal testing track. Could stay in
  TestFlight/internal-test forever (no public listing) to avoid review hassle.
- Acceptance: installable `.ipa`/`.aab`, launches to the game, online play
  works through the hosted relay, haptics on key beats.

## Recommended order
1 → 2 → 3. Each step is independently useful: PWA gives the kids an
"app" today; the hosted relay unlocks cross-house play; Capacitor is optional
polish/distribution on top.

## Risks / open questions
- **iOS PWA limits:** background audio + push are restricted, but this game
  needs neither. WebGL performance on older phones — test on the actual
  devices the kids use; the renderer already caps pixel ratio at 2 and reuses
  geometry, but we may want a "low detail" toggle for old hardware.
- **Relay cost:** free tiers sleep when idle (cold start ~seconds). For a
  family that's acceptable; a $5/mo instance removes it.
- **Card levels online:** currently disabled for fairness. If we later want
  progression in online matches, levels must be exchanged in the `start`
  handshake so both peers build the identical battle.

## Effort estimate (rough)
- PWA shell: ~1 day.
- Hosted relay + configurable URL + wss: ~1 day + deploy setup.
- Capacitor iOS+Android: ~3–5 days incl. icons/splash, more with store review.
