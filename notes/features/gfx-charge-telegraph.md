# Graphics: charge telegraph

- animateTroop gained a `charging` option (tested on the prince):
  the weapon arm couches an extra 0.55rad and the body leans in.
- Charged units shimmer gold via the consolidated emissive chain in
  scene3d: damage flash > rage pink > charge gold > restore.
  One `glowing` flag replaces the old per-effect bookkeeping.
