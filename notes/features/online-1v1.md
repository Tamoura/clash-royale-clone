# Online 1v1 (LAN, room codes)

Goal: let two kids on the same home WiFi play each other, not the bot.

## Decisions (from the user)
- **Connection:** same home WiFi (LAN). A small relay server runs on one
  computer; both devices connect to its local IP. No internet hosting.
- **Pairing:** shared room code. One taps *Create* and gets a short code
  (e.g. `LION`); the other types it to join.

## Architecture: deterministic lockstep
The sim (`src/game/`) is pure and deterministic — `tick(state, dt)` with no
`Math.random` / `Date.now` / wall-clock anywhere, and a fixed `SIM_DT = 1/30`
accumulator loop already drives it. So:

- **One canonical sim runs identically on both devices.** Host is side
  `player`, guest is side `enemy`. Same `createBattle(...)`, same
  `nextEntityId` sequence, same everything.
- The server is a **thin relay**: rooms by code, two slots, assigns
  host/guest, forwards input *frames*, signals start. No game logic on server.
- **Input frames every tick.** Each client emits one frame per tick for
  `tick + INPUT_DELAY` (possibly empty). A client only simulates tick T once it
  holds *both* players' frames for T → no desync from missing/late input. On
  LAN latency is sub-frame so the stall is invisible.
- **Canonical command order:** at a given tick, apply `player` commands before
  `enemy` commands, so `nextEntityId` increments identically on both ends.
- **Viewpoint flip (render only):** guest's camera + HUD flip so they sit at
  the bottom and see their own (`enemy`-side) hand. Sim coordinates stay
  canonical; only the view changes.
- **Drift detection:** exchange a cheap state checksum every N ticks; surface a
  "connection lost sync" message if they differ. (Auto-resync = later.)

## Build layers (each TDD'd where pure)
1. `src/net/lockstep.ts` — pure scheduler: buffer frames per tick/side, decide
   when a tick is ready, return commands in canonical order. **Unit-tested.**
2. `src/net/protocol.ts` — wire message types (create/join/start/frame/sync).
3. `src/net/roomClient.ts` — WebSocket wrapper (create/join/sendFrame/onFrame),
   testable against a fake socket.
4. `server/rooms.mjs` — pure room manager (slots, roles, start). **Unit-tested.**
   `server/relay.mjs` — tiny `ws` glue around it. Port 3100+.
5. Render viewpoint flip (`scene3d` camera + `hud` local side).
6. `main.ts` menu: *Play a Friend* → create/join code → lobby → online loop
   that pumps the lockstep frame pump instead of `tickBot`.

## Then: plan a mobile app (after 1v1 ships)

## How to play (for the parent hosting)
1. `npm install` once (pulls `ws`).
2. `npm run play` on one computer — it prints `http://<your-ip>:3101`.
3. Each kid opens that link on their device (same Wi-Fi), builds a deck,
   taps **Play a Friend**. One taps **Create a game** and reads the code
   aloud; the other types it and taps **Join**. Match starts.

## Verification
- `src/net/integration.test.ts`: two full peers over the lockstep transport,
  150 ticks, checksums bit-identical every tick (231 tests total pass).
- Real browser: host page created `DEER`, a node peer joined, host entered
  online mode and the lockstep advanced — opponent shown as "Friend".
- `?viewpoint=enemy` (dev) confirms the guest camera flip + HP bars render.

## Status — DONE
- [x] Layer 1 lockstep scheduler
- [x] Layer 2 protocol + checksum
- [x] Layer 3 room client
- [x] Layer 4 relay server + `npm run play` launcher
- [x] Layer 5 viewpoint flip (camera + perspective-aware HUD)
- [x] Layer 6 menu lobby + wiring + automated two-peer test

## Known limitations (future work)
- Drift detection warns but doesn't auto-resync (fine for same-device kids).
- No reconnect; if a device drops, the match ends and returns to menu.
- LAN only — `scripts/play-lan.mjs` is structured so the relay can later be
  hosted online without client changes.
