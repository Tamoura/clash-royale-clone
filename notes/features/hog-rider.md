# Hog Rider (river jump)

4-elixir fast melee troop that only targets buildings and leaps the
river instead of detouring to a bridge.

## Design decisions

- New `UnitStats.jumpsRiver` flag, mirrored onto the entity. Pathing
  (`moveGoal`) treats jumpers like flyers — straight to the target —
  but they stay ground units: hit by ground-only attackers, blocked
  by nothing else (there is no other terrain in this arena).
- Building-seeking reuses `targetsBuildingsOnly` (same as Giant).
- 3D rig follows the Prince's "mount with 4 legs" pattern; the walk
  cycle animates all four hog legs for a gallop.

## Stats

cost 4, HP 1500, dmg 260, hit 1.6s, melee, fast, sight 7.5,
buildings only, jumps river.
