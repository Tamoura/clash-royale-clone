# Feature: core-battle-loop

Branch: `feature/core-battle-loop`

## Decisions (from clarifying questions, 2026-06-11)

- Platform: **web browser** (TypeScript + Canvas, Vite on port 3100).
- Opponent: **AI bot** (single player, no networking).
- Scope: **core battle loop** — one arena, towers, elixir, 8 cards,
  3-minute match with win/lose. No meta game (deck builder, trophies).
- Original placeholder art only; no Supercell assets.

## Design notes

- Arena: 18 x 32 tiles, continuous coords in tile units. y=0 is the
  enemy back line, y=32 the player back line, river at y=16, bridges
  centered at x=3.5 and x=14.5.
- Towers per side: 2 princess towers + 1 king tower. King tower is
  passive until it takes damage or a princess tower falls (like CR).
- Elixir: start 5, +1 per 2.8s, cap 10; double rate in the final 60s.
- Deck: Knight, Archers (x2 units), Giant (building-only), Musketeer,
  Mini P.E.K.K.A, Skeletons (x3 units), Fireball, Arrows. Stats are
  simplified approximations, defined in `src/game/cards.ts`.
- Spells deal 40% damage to crown towers (CR-like rule).
- Pathing is simplified: troops needing to cross the river walk to the
  nearest bridge waypoint first, then to their target. No full A*.
- Match: 180s; king down = instant 3-crown win; else most crowns; tie
  goes to 60s sudden death (first tower wins); then draw.
- Simulation is pure + deterministic (fixed-dt `tick`), AI uses a
  seeded RNG so battles are reproducible in tests.

## Status

- [x] Scaffold (Vite/TS/Vitest, port 3100)
- [ ] Elixir + cards + hand cycling
- [ ] Arena geometry + deployment
- [ ] Battle sim (movement/targeting/combat/spells/towers)
- [ ] Match flow + win conditions
- [ ] AI bot
- [ ] Renderer + input + game loop
- [ ] Browser verification, push, PR
