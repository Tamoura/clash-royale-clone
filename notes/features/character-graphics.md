# Feature: character-graphics

Branch: `feature/character-graphics` (stacked on `feature/core-battle-loop`)

Replaces emoji-on-circle troops with hand-drawn vector characters in
`src/render/characters.ts`. Pure canvas paths — still zero assets.

## Design notes

- Characters are designed in a local 10-unit-radius space and scaled
  by pixel radius, so they stay crisp at any size.
- `Anim` drives motion: `bob` (walk hop, from `sin(state.time)`),
  `swing` (weapon attack, derived from the attack cooldown's first
  0.3s), `flip` (enemy units mirrored).
- Team readability: colored ground-ring under each troop plus
  side-colored HP bars (blue player / red enemy).
- Towers: stone bodies with seams, crenellations, team banner, door;
  king shows a drawn gold crown when awake and "z z" while asleep.
- HUD card slots and next-card preview reuse the same painters via
  `drawCardArt` (fireball/arrows get bespoke spell art).
- Troops render back-to-front (sorted by y) for correct overlap.

## Verification gotcha

Hidden tabs never fire requestAnimationFrame, so the canvas stays
blank after a reload in an unfocused MCP tab. Verified instead by
importing battle + renderer modules directly in the page and calling
`render()` synchronously, then pixel-probing the result.
