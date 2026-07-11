# Pre-rendered 3D card portraits (user idea: rendered images)

- cardportraits.ts: each troop's rig is rendered ONCE at startup
  (144px offscreen WebGL, studio lights, hero angle) and cached as
  a canvas; HUD card slots draw that portrait. Spells/buildings
  without rigs keep painted art (graceful null fallback).
- Performance: one tiny render per deck card per session; runtime
  cost is a cached drawImage. This is the "rendered images"
  pattern — could later extend to unit impostors if frame rate
  ever needs it.
