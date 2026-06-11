# Graphics: tower crew characters

- `buildTowerPrincess` (small archer: gown, tiara, bow rig) and
  `buildTowerKing` (robe, big crown, raised sword) exported from
  characters3d and unit-tested.
- Each tower mounts its defender in a wrapper group (animateTroop
  owns the rig's own transform, the mount owns yaw + slump).
- Defenders aim at the tower's current target and swing on attack
  using the same cooldown-driven swing as field troops.
- The sleeping king slumps forward over his battlements (zzz stays);
  the old floating-crown active indicator is gone — the king IS the
  indicator now. Team flag moved off-center to clear the roof.
