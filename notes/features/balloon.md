# Balloon (death bomb)

5-elixir flying building-seeker that drops huge bombs and blasts
nearby enemies when it dies.

## Design decisions

- New death-damage mechanic: `UnitStats.deathDamage` + `deathRadius`,
  mirrored onto the entity and applied in `processDeaths` just before
  the death event. Reusable for future cards (Giant Skeleton, Lava
  Hound pups would need spawn-on-death too).
- The blast pushes a `SpellEffect` so the renderer shows the explosion
  ring with no extra wiring.
- Test gotcha: troops placed around y≈20 are inside princess-tower
  range, so tower fire pollutes HP assertions. Death-bomb tests sit
  mid-river (y≈16) where no tower reaches.

## Stats

cost 5, HP 1500, dmg 600 every 3s, melee, medium speed, flying,
buildings only, death bomb 300 dmg in 1.5 tiles.
