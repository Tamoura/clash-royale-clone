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

## Status
- [ ] Layer 1 lockstep scheduler
- [ ] Layer 2 protocol
- [ ] Layer 3 room client
- [ ] Layer 4 relay server
- [ ] Layer 5 viewpoint flip
- [ ] Layer 6 menu + wiring + manual two-device test
