# Crown Rush

Crown Rush is a browser-based 3D lane-battle card game for kids, built
with TypeScript + Three.js (the repository keeps its first name,
clash-royale-clone, so saved progress and links keep working). You play
against an AI bot in a 3-minute, two-lane tower-defense battle, with fully
synthesized sound. The art is
procedural low-poly work of our own plus a CC0 character cast (see
[Assets and licences](#assets-and-licences)); the audio is Web Audio
synthesis. No Supercell assets are used.

## Gameplay

- One arena: two lanes, a river, two bridges.
- Each side has 2 princess (crown) towers and 1 king tower (the king
  sleeps until damaged or a princess tower falls — and wakes with a
  war-horn, shockwave, and screen shake). Towers show a live numeric
  HP readout and collapse into rubble with a camera shake when they
  fall.
- Elixir regenerates over time (max 10, double-elixir in the last 60s).
- 25-card deck, 4-card rotating hand: Knight, Archers, Firecracker,
  Magic Archer, Giant, Musketeer, Mini P.E.K.K.A, Skeletons, Wizard,
  Witch, Hog Rider, Balloon, Baby Dragon, Gargoyles, Valkyrie, Prince,
  P.E.K.K.A, Cannon, Tombstone, Elixir Collector, Fireball, Arrows,
  Zap, Rage, Freeze.
- CR-style mechanics: flying units (straight paths, only
  air-targeters can hit them), splash damage, the Prince's charge
  (2x damage after a run-up), deployable buildings that decay and
  bait building-seekers, a 1s deploy freeze, spawner troops (the
  Witch summons skeleton waves), river-jumpers (the Hog Rider skips
  the bridges), death bombs (the Balloon blasts its killers), stuns
  (Zap roots everything it hits), rage zones (friendly troops move
  and attack faster), piercing shots (the Magic Archer's arrow
  damages everything in a line), recoil (the Firecracker kicks
  herself backward after each shot), target persistence (an engaged
  attacker keeps hammering its current foe instead of chasing a
  newly deployed nearer one), and spells dealing reduced damage to
  crown towers.
- Destroy the enemy king tower for an instant win, otherwise most crowns
  when the clock runs out (sudden-death overtime on a tie, then a
  lowest-tower-HP tiebreak like CR). The
  result screen shows damage dealt and elixir spent per side.
- Opponent is an elixir-aware AI bot: it holds spells for clusters
  worth more than they cost, defends with troops that can actually
  hit the invader (air-targeters vs flyers, never building-seekers),
  and saves elixir when it has no good answer.

## Stack

- TypeScript, Vite (dev server on port **3101**), Vitest for tests,
  Three.js for rendering, Web Audio for synthesized SFX/music (the
  battle tune speeds up and gains percussion in double elixir and
  overtime).
- Game simulation is pure, deterministic, and fully unit-tested
  (`src/game/`); the 3D renderer, DOM HUD, and audio (`src/render3d/`,
  `src/audio/`, `src/main.ts`) are a thin shell driven by the sim's
  event stream.

## Development

```sh
npm install
npm run dev      # http://localhost:3101
npm test         # run the simulation test suite
npm run build    # typecheck + production build
npm run perf:budget  # draw-call, triangle and texture gates, both editions, phone and desktop (needs Chromium)
```

## Play a friend on your Wi-Fi (1v1)

```sh
npm run play     # starts the game + a small relay, prints a link to share
```

Open the printed `http://<your-ip>:3101` link on each device (same Wi-Fi),
then tap the sliders row under **Battle** → **Play online** → **Play a friend**.
One player taps **Create a game** and reads the code aloud; the other types it
in and taps **Join**. If **Play online** is greyed out, take the Champion out
of your deck (it is for bot battles only). Online play is friends-only: there
is no matching with strangers, only room codes (a word plus three digits,
like `LION042`) shared with people you know.

Both devices run the identical, fully-deterministic simulation in lockstep —
the relay (`server/relay.ts`) only forwards each player's deploys, never the
game state. See `notes/features/online-1v1.md` for the design.

## Play online: one click on Render (easiest)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/tamoura/clash-royale-clone/tree/claude/game-visuals-character-balance-w122wb)

Sign up at Render with GitHub, click the button, and wait for the build. You get
one free address (`https://<name>.onrender.com`) that serves the game *and* the
online server: both kids open it and tap the sliders row under **Battle** →
**Play online** → **Play a friend**. Steps, the free-plan sleep, and what to do
if the button cannot find `render.yaml`:
[docs/deploy-multiplayer.md](docs/deploy-multiplayer.md#easiest-one-click-on-render).

On any other Node host (or your own computer) it is the same two steps:

```sh
npm ci --include=dev && npm run build:all   # the game + the relay bundle
npm start                                   # both on $PORT (default 3110)
```

It only lets in pages from its own address; add others with `ALLOWED_ORIGINS`.

## Other ways to play online

To keep the game on GitHub Pages and run only the relay elsewhere:

```sh
npm run build:relay   # bundle the relay into dist-server/relay.mjs
npm run relay:prod    # run it, relay only (or deploy the Dockerfile / fly.toml)
```

[docs/deploy-multiplayer.md](docs/deploy-multiplayer.md) walks through it
step by step. It covers a free 5-minute test through a Cloudflare tunnel, a
permanent Fly.io deploy, wiring GitHub Pages with the `RELAY_URL` variable,
and troubleshooting. `node tools/relay-smoke.mjs wss://<relay>/ws` checks a
running relay end to end.

## Assets and licences

- **Characters**: every humanoid card and the tower crews are built from the
  CC0 [KayKit Adventurers](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0)
  and [KayKit Skeletons](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0)
  character packs 1.0 by Kay Lousberg, packed by `tools/troop-pack.mjs` into
  `public/models/troops/` (about 0.8 MB, loaded at boot and precached by the
  service worker). Each card is a variant baked at run time: hats, capes,
  weapons, palette and a Golden Age overlay on the same rigs. Sources, commits
  and SHA-256 hashes are in that folder's `CREDITS.txt`.
- **Everything else is procedural**: towers, ground, river and bridges, the
  tournament court and its crowd, creatures, mounts, card buildings and every
  effect are built in code (`src/render3d/`).
- **Fonts**: Lilita One and Baloo Bhaijaan 2 (SIL OFL 1.1), from `@fontsource`.
- **Libraries**: three.js and its meshopt decoder (MIT); `ws` for the relay (MIT).
- The full list, with versions and hashes, is in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Every folder under
  `public/models/` must carry a `CREDITS.txt` with the source URL, version,
  licence and SHA-256 of what was read; only CC0 packs and our own procedural
  art go in. The art direction behind the look is in
  `notes/features/art-direction-2026-11.md`.
- Dev A/B: `?troops=rigs` (dev server only) plays a battle with the
  procedural roster instead of the cast.

## Project conventions

- TDD (red-green-refactor); simulation logic never touches the DOM.
- Feature notes live in `notes/features/`.
