# Elixir Collector (economy building)

6-elixir rare building, 70s lifetime, never attacks; pays its owner
1 elixir every 8.5s (capped at ELIXIR_MAX).

- New `UnitStats.elixirInterval` -> Entity elixirInterval/elixirTimer
  (buildings only; troops/towers zeroed); `tickCollector` in the sim
  next to the spawner tick, pushing a purple payout effect.
- 3D: hooped wooden vat with a glowing elixir surface + rising drop.
  2D HUD art matches.
- Tests: bonus vs control battle over 10s (>=1, <2.5), and the enemy
  never profits.
