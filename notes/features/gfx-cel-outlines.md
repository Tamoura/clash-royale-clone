# Graphics: cel outlines

- `outlineRig(group)` adds inverted-hull silhouette meshes
  (BackSide black, scale 1.06) to every mesh whose scaled bounding
  sphere is >= 0.14 — tiny details (eyes, nostrils, gems) stay
  unlined so they don't turn to mud.
- One outline material per rig: the death fade clones/marks
  materials transparent, so sharing across rigs would make every
  unit's outline fade when one dies.
- Applied in buildTroop (all field troops + deploy ghosts) and to
  the tower princess/king defenders.
