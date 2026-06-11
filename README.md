# Clash Royale Clone

A browser-based clone of the Clash Royale core battle loop, built with
TypeScript + HTML5 Canvas. You play against an AI bot in a 3-minute,
two-lane tower-defense battle. All art is original placeholder rendering
(shapes/colors) — no Supercell assets are used.

## Gameplay (v1 scope)

- One arena: two lanes, a river, two bridges.
- Each side has 2 princess (crown) towers and 1 king tower.
- Elixir regenerates over time (max 10, double-elixir in the last 60s).
- 8-card deck, 4-card rotating hand: Knight, Archers, Giant, Musketeer,
  Mini P.E.K.K.A, Skeletons, Fireball, Arrows.
- Destroy the enemy king tower for an instant win, otherwise most crowns
  when the clock runs out (with sudden-death overtime on a tie).
- Opponent is a simple elixir-aware AI bot.

## Stack

- TypeScript, Vite (dev server on port **3100**), Vitest for tests.
- Game simulation is pure, deterministic, and fully unit-tested
  (`src/game/`); the canvas renderer and input layer (`src/render/`,
  `src/main.ts`) are a thin shell over it.

## Development

```sh
npm install
npm run dev      # http://localhost:3100
npm test         # run the simulation test suite
npm run build    # typecheck + production build
```

## Project conventions

- TDD (red-green-refactor); simulation logic never touches the DOM.
- Feature notes live in `notes/features/`.
