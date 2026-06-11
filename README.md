# Clash Royale Clone

A browser-based 3D clone of the Clash Royale core battle loop, built
with TypeScript + Three.js. You play against an AI bot in a 3-minute,
two-lane tower-defense battle, with fully synthesized sound. All art
and audio are original (low-poly primitives + Web Audio synthesis) —
no Supercell assets are used.

## Gameplay

- One arena: two lanes, a river, two bridges.
- Each side has 2 princess (crown) towers and 1 king tower (the king
  sleeps until damaged or a princess tower falls). Towers show a live
  numeric HP readout.
- Elixir regenerates over time (max 10, double-elixir in the last 60s).
- 20-card deck, 4-card rotating hand: Knight, Archers, Giant,
  Musketeer, Mini P.E.K.K.A, Skeletons, Wizard, Witch, Hog Rider,
  Balloon, Baby Dragon, Gargoyles, Valkyrie, Prince, P.E.K.K.A,
  Cannon, Fireball, Arrows, Zap, Rage.
- CR-style mechanics: flying units (straight paths, only
  air-targeters can hit them), splash damage, the Prince's charge
  (2x damage after a run-up), deployable buildings that decay and
  bait building-seekers, a 1s deploy freeze, spawner troops (the
  Witch summons skeleton waves), river-jumpers (the Hog Rider skips
  the bridges), death bombs (the Balloon blasts its killers), stuns
  (Zap roots everything it hits), rage zones (friendly troops move
  and attack faster), and spells dealing reduced damage to crown
  towers.
- Destroy the enemy king tower for an instant win, otherwise most crowns
  when the clock runs out (with sudden-death overtime on a tie). The
  result screen shows damage dealt and elixir spent per side.
- Opponent is an elixir-aware AI bot: it holds spells for clusters
  worth more than they cost, defends with troops that can actually
  hit the invader (air-targeters vs flyers, never building-seekers),
  and saves elixir when it has no good answer.

## Stack

- TypeScript, Vite (dev server on port **3101**), Vitest for tests,
  Three.js for rendering, Web Audio for synthesized SFX/music.
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
```

## Project conventions

- TDD (red-green-refactor); simulation logic never touches the DOM.
- Feature notes live in `notes/features/`.
