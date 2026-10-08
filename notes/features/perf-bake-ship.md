# Perf and ship: baked rigs, shared ink, budgets, recovery, deploys

## Rig baking (`src/render3d/rigBake.ts`)

`bakeRig(rig, key)` runs once per troop view (after `buildTroop`, before the
view scales it). A hand-built rig is 20-80 meshes plus an ink hull per mesh;
a baked one is at most `MESH_BUDGET` = 14 meshes and at most 5 materials.

- Every part that never moves relative to its animated node merges into one
  vertex-coloured mesh per node (root, arms, legs, wings, the head, anything
  the idle quirks drive). Part colour is baked into a `color` attribute;
  grainless parts (skin, faces) point their UVs at the grain map's white
  texel, so one material (`bakedToon`, a clone per unit for the flash, rage
  and freeze glows) serves both looks.
- Which nodes animate is measured, not listed: the rig is posed through
  `animateTroop` in six walk/attack poses and every object whose transform,
  visibility or material changed is a node. Extras callbacks are covered
  this way (orbiting embers, ear flaps, tail wags).
- Kept as separate meshes: `team` (merged per node; `userData.team` is
  `main`, `dark` or `both`, dark parts read the material's `teamDark`, so the
  palette repaint still works), the face (eye + rim merged into one `eye`
  mesh, the pupils one `pupil` mesh, brows and mouth recoloured in place),
  `orb`, `userData.noBake` parts and anything transparent, emissive or
  double-sided.
- Over budget: lockstep legs (a mount's front pair) share a mesh exactly;
  then the nodes that move least fold into their parent (the head's stun
  wobble first, then a tail or an ear); then the pupils join the eyes. A node
  that travels more than 0.45 rig units never folds.
- Geometry and the audit are cached per card and edition and shared by
  reference (`userData.shared`), so `disposeDeep` skips them and every unit
  of a card draws from the same buffers. The Studio champion is never cached.
- Tower crews are baked the same way; portraits and the gallery are not.

## Other pieces

- Shatter deaths break a baked body into its biggest 4-8 node meshes.
- A lost WebGL context is cancelled (so the browser may restore it); on
  restore the arena is rebuilt, the views dropped and the next sync recreates
  them (`Battle3D.recoverFromContextLoss`).
- Card portraits reuse one offscreen renderer, dispose each capture's rig and
  scene, and release the renderer (and its GL context) 4 s after the last use.
- `vite build` puts three.js in its own `three-*.js` chunk. `public/sw.js`
  names its cache after a per-build id (`__BUILD_ID__`, stamped by a Vite
  plugin), deletes older caches on activate, serves `/assets/*` cache-first
  without refetching, and index.html network-first.
- `tools/perf-budget.mjs` enforces 450 draw calls for the 12-card fight and
  220 for the empty battle (`--max-calls`, `--max-empty-calls`, `off` to skip).
