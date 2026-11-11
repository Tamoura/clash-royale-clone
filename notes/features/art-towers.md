# Art package: towers

Branch `art/towers` (from `art/base`, b7ae4ce), worktree `/home/user/wt-art-towers`, dev port 3203.
Spec: `notes/features/art-direction-2026-11.md`, "### towers" and the art bible section 2.

Owns: `src/render3d/scene/views/towers.ts`, `towers.test.ts`, `towerCraft.ts`, `towerStyles.ts`,
`towerStyles.test.ts`, `src/render3d/towerCollapse.ts`, `towerCollapse.test.ts`, this file.

## Perf budget

`node tools/perf-budget.mjs --url http://127.0.0.1:3203 [--edition arabic]` (390x844@2, quality=high, first arena).

| When | Edition | Empty calls | Empty tris | Fight calls | Fight tris | Fight textures |
|---|---|---|---|---|---|---|
| start (b7ae4ce) | classic | 178 | 266,074 | 432 | 769,658 | 49 |
| start (b7ae4ce) | golden | 167 | 137,566 | 402 | 509,454 | 49 |
| end | classic | see below | | | | |
| end | golden | see below | | | | |

Acceptance ceilings: empty calls at most start + 6 (classic 184, golden 173, and golden at most 200);
all six towers at most 60k triangles at L0.

Tower triangles at L0 (all six, ink included, measured in the battle): classic ~34k, golden ~49k. The
test `towerStyles.test.ts` builds all 22 looks x both viewpoints at flair 2 (the heaviest dressing) and
holds every set of six at or under 60k.

## Decisions

- **One mesh, one draw per tower.** `towerCraft.ts` sculpts the whole keep (plinth, walls, gate, banner,
  battlement, turrets, roofs or domes, deck, flag, king canopy, look extras, damage parts) into ONE
  non-indexed mesh (`KeepSculpt`) drawn by ONE per-tower material (`keepMaterial`, a painted toon with
  ramp + rim like every sculpt). Per-vertex flags tell the shader what each part is:
  - `aFlags.x` share of the live team colour (`uTeam` uniform): roofs, domes, trim, banner, flag;
  - `aFlags.y` texture slot: ashlar (the look's BrickVariant), alpha-tested crack decal, roof tiles
    (a grey scallop multiplier: the Classic cones and, as fish-scale glaze, the Golden Age domes),
    zellige band (THEME turquoise and gold);
  - `aFlags.z` silhouette-ink hull; `aFlags.w` self-glow (ember cracks, neon strips, lit slits; kept
    well under the bloom threshold);
  - `aStage` the damage stages [from, to) a part shows in (`uStage` uniform).
  A king or cannoneer tower adds one more draw: its cannon is its own mesh on the same material, so it
  can swing at its target (and lie low while a king sleeps, rising as he wakes).
  Result: the empty battle dropped from 178 to ~112-132 calls (classic) and 167 to ~135 (golden).
- **Team colour is live.** `towerTeamColors().cloth` is now `teamColor(team, "main", palette)` (was
  the fixed SIDE_COLOR), so roofs and domes are the teamColors blue/red, or blue/orange under the
  colour-blind palette. `repaintTowers(palette)` runs on `onPrefs` and repaints standing towers AND
  ruins (keep uniforms + HP fill) without a rebuild.
- **Ink:** silhouette-only, inside the same draw: hull vertices (smoothed normals, wound inside out)
  are pushed 1.6 CSS px in clip space and 0.45 world units away from the camera, so only the outer
  outline survives; no fins, no lines on bricks or windows. Hulls sit after the surfaces in the
  vertex buffer (`geometry.userData.bodyCount`), so the shadow pass never draws them, nor does the main
  pass when quality turns ink off (`INK.uInkOn`, L4).
- **Massing:** both editions use the Classic heights (princess 2.15, king 2.7; radius 0.95 / 1.28, scale
  1.1, so `groundPaint.TOWER_FOOTPRINT` is unchanged). The gate is on the camera face; the team banner
  drapes over the parapet on the camera face, clear above the gate. All four faces are modelled
  (quoins, slits, corbels, merlons all round); `camSide` follows the viewpoint, so the online guest gets
  the same front.
- **Classic:** C's keep, cleaned: smooth bell-cast lathe cones (16 segments, smooth normals, tiled),
  team eave ring, gold finials; team string course under the parapet, team band on the plinth top, team
  inlay on the paving. King: a round team pavilion (scalloped valance, tiled bell roof) on four gold posts
  over his dais, set back so his face and crown show under its front edge; crown crest on the banner;
  banded cannon.
- **Golden Age:** the same massing in the look's ashlar; horseshoe gate with striped voussoirs and a gold
  alfiz; stepped Moorish merlons with pointed caps; a zellige band at the parapet and on the turret drums;
  team onion domes (arena/build.ts `onionDome` geometry, read only, passed in as a factory to avoid an
  import cycle) with gold crescent finials; a domed qubba on four posts over the king; crescent (princess)
  or eight-point star (king) on the banner; a tiled star on the deck.
- **Per look** (`towerStyles.ts`): stone, plinth, battlement and platform from `ArenaLook.tower`; extras
  from `LOOK_EXTRAS`: snow caps + icicles + drifts (snow, ice, atlas), glowing ember seams (forge, copper),
  ivy (jungle, ghouta), pale team-tint neon strips (neon), bone lintels (bone); lit slits on night-native
  looks.
- **Flair:** tier 1 gilds the string courses, merlon caps and finials (tall spires); tier 2 adds a ruby
  crest on the banner and gold bands round every cone and dome.
- **Crew seam:** `setTowerCrewProvider(p)` with `TowerCrewProvider { make(kind, side, edition),
  animate(unit, state, dt), dispose(unit) }` (method syntax, so cast-kit's `towerCrewProvider` with its
  richer `CrewUnit` type-checks). `make` gets the VIEWER-relative team and "classic" | "golden". A
  provider's group is mounted at the deck (or the king's dais) and scaled by 1/TOWER_SCALE, so provider
  sizes are world sizes; the king canopy's height follows the crew's height. Without a provider (or
  when `make` returns null) the hand-built crew shows, with the king's crown opened into a band with
  five short points (no more "sunflower" disc from above). Idle, the king faces the camera.
- **HP plates:** placed every frame in screen space (`towerStyles.ts` maths): far towers above the
  tallest roof tip, near towers under the gate foot, at least 4 CSS px (we keep 6) clear; when the
  preferred side would leave the screen or slide under the HUD insets (`b.framing.insets`), the plate
  flips to the other side (the Golden Age far king, whose qubba is tall, flips under his gate on the
  phone). The plate floats toward the camera so the keep never hides it.
- **Damage:** stage 1 below 70% HP (two crack decals: the camera face and a side; the camera-side left
  merlon chipped to a stub, the flag leans); stage 2 below 40% (two more cracks and one on the deck; two
  more merlons down to stubs; a patch of tiles torn off the camera-side cone or dome showing rafters; the
  banner torn short and darker; the flag torn and hanging; one smoke wisp from the roof patch every
  0.75 s). Chips burst from each merlon that breaks; `markShadowsDirty` on every stage.
- **Collapse and ruin:** the keep splits by draw range into rigid chunks (front turret pair with roofs,
  back pair, upper keep with banner and cannon, and the king's canopy) plus the crew; they topple
  (`towerCollapse.ts` CHUNK_ORDER canopy, crew, front, back, upper) with dust where each lands. The base
  hides at once: the ruin (`craftRuin`) stands in its place: the scorched paving and plinth, a jagged
  broken stump with a dark hollow and a broken gate, a rubble mound spilling out of the gate, rubble on
  the heap inside, team roof shards and the fallen team banner. The stump is there at once; the heap
  rises while the chunks rain down. The FX crater decal stays. No grey disc, no mud.

## Requests for ship

1. **scene3d.ts:** `setTowerCrewProvider(towerCrewProvider)` (cast-kit's `src/render3d/cast/crew.ts`), as
   cast-kit's notes also ask. Towers built afterwards use it; each battle rebuilds its towers.
2. **Shadow cost (stage / ship):** the keeps are static until damaged or felled, but on this base the
   shadow map re-renders every frame, so each keep's ~5-8k triangles count twice per frame (classic empty
   battle 284k triangles vs 266k at the start; the hard gate is 300k). The stage package's "static set
   renders on demand" policy removes that; towers already call `markShadowsDirty` on every damage stage,
   collapse and ruin.
3. The fallback (hand-built) crew casts no shadow, as before; a provider's crew casts (one caster per unit).

## Screenshots

- Iterations: /tmp/claude-0/art/towers/it/
- Matrix: /tmp/claude-0/art/towers/<edition>-<arena>-<viewport>.png
- Close-ups: /tmp/claude-0/art/towers/closeups.png; damage: /tmp/claude-0/art/towers/damage.png

## Known gaps

- The tower crews are the hand-built ones until ship wires the provider; the hand-built crews are small
  multi-limb rigs (about 15k triangles each with their ink, unchanged from the base).
- Crack decals are alpha-tested without mipmaps (so the splits survive minification); at 1440x900 they
  alias a little.

## Progress log

- Worktree created from art/base; start perf recorded.
- 199cfdc..93b58e9: keep rewritten as ONE mesh per tower (towerCraft.ts KeepSculpt + keepMaterial) for both
  editions; live team colour by uniform; silhouette ink in the same draw; damage stages by uniform; crew seam;
  screen-space HP plates; chunked collapse + ruin; tests (towers, towerStyles, towerCollapse) green.
- 292261e: ink hulls after the surfaces (shadow pass and L4 skip them); fallback crew casts no shadow.
  Full vitest (137 files, 1560 tests), tsc and build green.
- Next: matrix, close-up and damage sheets; final perf numbers into the table; final quality bar.
