# Three.js best-practices round (three-best-practices skill)

Audit findings + fixes against the skill's CRITICAL rules:
- memory-reuse-objects: primitive helpers (box/sphere/cyl/cone) now
  share one BufferGeometry per unique dimensions via a keyed cache
  (geo.userData.shared = true), tested across rig instances.
- memory-dispose-recursive: new exported disposeDeep(root) frees
  geometry/material/texture of every dynamic object, sparing
  userData.shared resources and the Sprite class's global plane
  geometry (tested). Wired into all 10 removal sites: effects,
  dying views, projectiles, ghost preview, rubble, and reset().
  Shared label materials, the stun-star texture, and the HP pill
  texture are flagged shared.
- render-avoid-allocations: syncProjectiles uses module scratch
  vectors instead of cloning Vector3s every frame.
