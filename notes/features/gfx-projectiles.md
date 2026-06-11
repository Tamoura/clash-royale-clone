# Graphics: projectile variety

- New pure module render3d/projectiles.ts: `projectileStyle(cardId,
  kind)` returns form/color/size/glow/arc/duration/muzzleFlash.
  Unit-tested; scene3d's projectile() consumes it instead of the
  old inline ternary.
- Witch now fires her own green soul-bolt (was the generic ball).
- Glowing orbs (wizard/witch/dragon) drag a light-streak trail.
- Musketeer shots got faster + a muzzle flash at the barrel.
