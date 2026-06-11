# Match stats + end screen

Per-side battle statistics surfaced on the result overlay.

## Design

- `SideState.stats` (`damageDealt`, `elixirSpent`), pure sim data.
- Damage accumulates at every damage source: troop hits + splash
  (`dealDamage`), spells (`applySpell`, with the crown-tower
  reduction applied first so the number matches HP actually removed),
  and death bombs.
- Elixir is recorded in `deployCard` only after the spend succeeds.
- HUD result overlay grew a small two-column scoreboard
  (player gold / enemy red) under the crown score.
