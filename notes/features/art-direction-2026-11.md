# Art direction 2026-11: "Toy Tournament"

The owner said the cards took too much of the arena and the graphics were still bad. The card tray was shrunk first (`notes/features/compact-hand.md`). For the graphics, three in-engine prototypes were built from the same battle scene and scored blind by three critics (an art director, a parent/UX designer and a technical artist):

| Entry | Direction | Critic ranks |
|---|---|---|
| B | **kit-everything**: CC0 KayKit characters baked to one inked draw each, kit environment | 1st, 1st, 1st |
| C | **handcrafted-plus**: procedural team-roofed castles, tournament court, painted ground, low sun | 2nd, 2nd, 2nd |
| A | **kit-world**: KayKit castle, hex towers and village around the old troops | 3rd, 3rd, 3rd |
| BASE | the game at 0a8c97d | last |


## Decision

**Winner:** B (kit-everything) for the characters, grafted onto C (handcrafted-plus) for the towers, ground and tournament court. A's (kit-world) grey hex towers, KayKit castle and tilt-shift are dropped. Working name: "Toy Tournament".

My own read of the phone shots (direction board: /tmp/claude-0/art/direction-board-phone.png) agrees with all three critics: B > C > A > BASE. Neither B nor C is good enough alone. Each fixes the half that the other leaves at baseline.

WHY B'S CAST IS THE CORE
- Kids watch the troops, and 31 troop cards depend on them. B is the only entry that replaced the vinyl dolls with one character system:
  - CC0 KayKit bodies, each baked to one inked skinned draw;
  - team colour on the body;
  - card portraits rendered from the same models;
  - real animation clips.
- It also cut the 12-card fight from 376 to 266 draw calls.
- Enemy troops seen from the front now have faces, hats and weapons. That is the "real game" leap the parent is asking for.
- The baseline ?models=kaykit opt-in read as dark blobs. B did not, because of the bake, ink, rim, brighter palette and scale-up. Production must keep all five.

WHAT B GETS WRONG
- Your own troops are seen from behind and above, so they read as hat discs: blue dish wizard, green "V" hoods, orange-ball giant and valkyrie. Today they are no better than the baseline blobs.
- Team colour breaks its own rule: a navy enemy Mini P.E.K.K.A., and a wizard hat that flips colour with the team.
- Haze and bloom wash out the midfield. Damage numbers turn white and unreadable. Hit flashes blow out.
- Floating name tags are about 6 px tall, too small to read.
- The tower archers are oversized, and the king reads as a "sunflower" from above.
- B inherits A's towers: neutral grey hex keeps with weak team read, black ink fins and faceted roofs.

WHAT C ADDS
- C's castles give the best instant team read: red or blue cone roofs, team trim and banners. They are crisp, carry no ink fins, and already take colours per look (BrickVariant and ArenaLook inputs).
- Its tournament ring (kerb, team bleachers, striped pavilions, pennants) is the most kid-friendly first impression.
- It brings pebble-edged paths, timber bridges, a recessed river, the warm low sun, and the only real destroyed-tower state (rubble plus scorch).
- Its weak points are fixed in this plan:
  - the loud lime checkerboard;
  - the pawn crowd;
  - roofs mixed with front-elevation walls;
  - HP bars that collide with the roofs.

THE GRAFT
- Take B's character pipeline and C's set.
- Add a new ground pass. All three entries left the floor weak, and it is now the biggest flat surface on screen.
- Add a render-only 14-degree lean toward the camera, plus back-readable designs, so your own troops show identity from behind.
- Enforce one strict team-colour rule for all cards.
- Clean up post-processing: no haze, a high bloom threshold, capped flashes and outlined damage numbers.
- From A, keep only the ideas, not the code: silhouette-only ink, quality tiers that still look finished at the lowest level, and a village outer ring for wide screens (optional to build from the KayKit hex pack).

WHY THIS SPLIT
- Phones get most of the gain: castles, cast, ground, and the far band that the compact-hand tray frees above the board.
- Tablets and laptops get the full world.

GOLDEN AGE
- Every new tower and troop ships with a Golden Age variant on the same rig, so that edition never falls back to the old dolls again. That was A's and B's biggest coherence failure.


## Execution

- Every wave-1 package branches from `art/base`: the live branch with the compact tray merged (`ed45f9c` and later), plus the handcrafted-plus prototype merged on top. It does not branch from the bare prototype commit `52a1c29`, so all work sees the final tray and framing.
- Each package is built, reviewed, fixed and then merged into `claude/game-visuals-character-balance-w122wb` and pushed as soon as it passes. A final integration package (`ship`) wires the seams, unifies the material constants, runs the budgets and the full verification matrix, and writes the owner's before/after sheet.
- Prototype branches, kept locally: `proto/kit-everything` (B, `49d0001`), `proto/handcrafted-plus` (C, `52a1c29`), `proto/kit-world` (A, `e4be8f7`).


## Ship log

### 1. stage (with art/base)

`art/stage` merged with --no-ff (it brings `art/base`: the handcrafted-plus prototype on the compact tray). No conflicts; the dry-run merges of towers, creatures-fx and cast-kit on top stay clean too.

- Seams: none to wire yet. The crew provider needs towers and cast-kit; the `castReady()` battle-start gate needs cast-kit. The crowd events (`arenaOnEvent`, `updateCrowd`) are already called from scene3d.ts.
- Stage request 1 applied in part: one troop shadow caster per unit (`ranked.slice(0, 1)` in troops.ts). The line and comment match cast-kit's own change, so its merge stays clean. Still open for the cast-kit merge: call `registerTroopCaster(mesh)` and `troopShadowLevel()` with no argument (both give the same result as today's code).
- Still open for later merges:
  - cast-kit: mixer rate from `currentQuality().mixerHz` (60, 30 or 20 Hz) and one shared pose per swarm at L4 (request 2); blob shadow offset by `SHADOW_SLOPE` times the unit's height on L1 to L3 (request 3).
  - cast-kit and creatures-fx: albedo + rim + hit flash under `BLOOM.threshold` (0.92 linear); the fireball impact puff must not read as an opaque white disc (request 4).
  - towers: measure the camera-facing walls under the stage's `LIGHT_RIG` (sun from the upper left); if a wall looks dull, lift its albedo, never move the sun. The aprons are painted to `TOWER_FOOTPRINT + APRON` (0.62 tiles) (request 5).

perf-budget after the merge (`?quality=high`, training-camp, dev server). Gates: empty <= 220 calls, fight <= 450 calls.

| View | Edition | Empty calls / tris | Fight calls / tris | Fight textures |
|---|---|---|---|---|
| 390x844@2 | Classic | 176 / 202,978 | 419 / 669,718 | 49 |
| 390x844@2 | Golden Age | 170 / 191,770 | 419 / 678,878 | 49 |
| 1440x900@1 | Classic | 178 / 226,100 | 415 / 692,752 | 49 |
| 1440x900@1 | Golden Age | 176 / 207,666 | 426 / 694,918 | 49 |

One caster per unit cut the fight by 12 to 16 calls compared with the stage's own end numbers (431 to 438).

### 2. cast-kit

`art/cast-kit` merged with --no-ff on top of the stage. No conflicts: troops.ts auto-merged (the stage's one-caster line matched cast-kit's own). The merge takes cast-kit's deletion of `viewer.html`, `src/viewer.ts`, `glbModels.ts` and `public/models/kaykit` (cast-kit request 2: an orphan dev page that only loaded the deleted pack).

- Wired (main.ts, battle-start cast gate only):
  - Every solo start (ladder, daily, draft, challenge and the tutorial, replay, Play again, sandbox reset) goes through `afterCastGate`. If the pack has settled (loaded or failed), the start runs at once, so nothing changes in the usual case. Otherwise it waits for `castReady()` or 3 s, with the solo sim held, and the latest request wins.
  - `beginCastBattle()` runs just before each `scene.reset()`, so a battle fields the cast or the procedural roster for its whole length.
  - Online matches (match/online.ts, outside ship's main.ts exception) cannot wait on the lockstep peer. They latch what is loaded at `matchStart`, which comes right after their reset and before any unit is built.
- Wired (scene3d.ts): `setLeanCamera(this.camera)` at the top of `sync()`, before any unit or crew is built or posed (cast-kit request 0).
- Not wired yet: `setTowerCrewProvider(towerCrewProvider)`. towers.ts has no provider seam until art/towers lands, so the towers keep the hand-built crew.
- Requests applied:
  - Stage 1 (rest): troops.ts registers its one caster per unit through `registerTroopCaster()`.
  - Stage 2: the cast's mixers step at `currentQuality().mixerHz`, and `mixerHz(i)` reads `QualityLevel.mixerHz`. The rates are the same as before (60/60/30/30/20). Swarm pose sharing was already in at every level (`SWARM_SHARE` 6).
  - Cast-kit 1: the cardwaveFx test that pinned the white troop snap is now a cap check on `troopFlashTint`: at most 0.35, warm, and gone at the end. `hitFlashTint`'s legacy troop branch now defers to `troopFlashTint`.
- tools/perf-budget.mjs: it now starts the battle only once the DEV log says "cast: pack ready" (or "failed"), and prints `cast` with the counters. With the gate latching per battle, a slow software-GL boot would otherwise measure the procedural roster.
- Gate checks (dev server, phone):
  - Pack in before the tap: every humanoid is cast, and so is a second wave.
  - Tap at the moment the pack lands: cast.
  - Pack held back 15 s by request interception: the battle starts 3 s after the tap with the procedural roster, and a second wave spawned after the pack arrived is still procedural. No mixing.
  - Fresh Golden Age profile (production build): the tutorial starts through the gate at boot.
- Size: initial JS `index-*.js` 322.8 KB gz (art/base 294.1 per the cast-kit notes, so +28.7). GLTFLoader (13.2 KB gz) and meshopt (7.3 KB gz) are lazy chunks. dist/ is 2.8 MB.

perf-budget after the merge (`?quality=high`, training-camp, dev server, cast measured in every run). Gates: empty <= 220 calls, fight <= 450 calls.

| View | Edition | Empty calls / tris | Fight calls / tris | Fight textures |
|---|---|---|---|---|
| 390x844@2 | Classic | 176 / 202,978 | 256 / 568,128 | 65 |
| 390x844@2 | Golden Age | 170 / 191,770 | 264 / 585,808 | 64 |
| 1440x900@1 | Classic | 178 / 226,100 | 259 / 591,134 | 65 |
| 1440x900@1 | Golden Age | 176 / 207,666 | 274 / 601,652 | 64 |

The cast takes the 12-card fight from 415-426 calls down to 256-274 and cuts about 100k triangles. Textures rise from 49 to 64-65: the per-variant atlases and bone textures.

Still open for the final integrator:
- With art/towers: `setTowerCrewProvider(towerCrewProvider)` in scene3d.ts. make() takes the viewer-relative team (towers.ts `teamSide(e.side)`) and "classic" | "golden" from `ARABIC`; crews are 0.72 of field size. The per-frame lean camera is already in.
- Stage request 3: offset the cast's blob shadow by `SHADOW_SLOPE` times the unit's height on L1 to L3 (not done; needs a by-eye check).
- Stage request 4 and cast-kit review (minor):
  - The Golden Age janissary's CREAM bork still peaks over the 0.9 bloom threshold in some frames (luminance 0.94-0.96).
  - The Golden Age tower-king turban (0xf2f0ea) reaches #FFFFFF on the contact sheet; it will show in battle once the crew provider is wired.
  - Fix options: darken CREAM toward 0xe2d4b6, cap sun-facing extras near 0.78, or clamp the lit colour in the cast shader under about 0.85. Then add a troopview probe at several yaws.
- Cast-kit review (minor): the Golden Age valkyrie's keffiyeh drape hides her braids from behind (spec 5c). Either end her drape near y 1.55 or hang the braids past the hem (0.6 or more from the centre). Then re-shoot the 'behind' cells.
- Constants: OUTLINE_CSS_PX is still 1.25 globally, while the cast's shell is drawn at 1.6 px (CAST_INK_PX). Unify on 1.6 and #1F1A2E in look/material.ts once creatures and towers land. The cast's ink is opaque, because it shares the body's draw.
- Sign off the hat-height exception (wizard 2.98, ice-wizard 2.95, executioner 3.05, janissary 3.04, duelist 2.91) or ask for shorter hats.
- Known gaps:
  - The Studio preview (src/ui, frozen) still uses the procedural champion rig.
  - Mounts gallop procedurally, and their heads are blocky from the front.
  - views/animate.ts still calls `setLeanCamera` per entity. That call is now redundant and harmless.

Screens (looked at, against /tmp/claude-0/proto/baseline/):
- Dev standard scene: /tmp/claude-0/art/ship-cast-kit/dev-{classic,golden}-{phone,desk}.png.
- Gate checks: dev-early-classic-phone.png and dev-slowpack-classic-phone.png.
- Production build: prod-{classic,golden}-{phone,desk}-{home,start,battle}.png and prod-golden-fresh-tutorial.png.
- No page or console errors, and every troop GLB returned 200.

### 3. creatures-fx

`art/creatures-fx` merged with --no-ff on top of cast-kit. No conflicts: it shares no file with the stage or cast-kit merges, and it brings the new dev-only `tools/creatureview.html` (creatures-fx request 10, accepted as is).

- Seams: nothing new to wire. The crew provider still waits for art/towers (`setTowerCrewProvider` is not on the branch yet), and the `castReady()` battle-start gate went in with cast-kit.
- Requests applied (troops.ts and animate.ts, one wiring commit):
  - 1 and 9, the card buildings: `buildBuildingMesh` builds `buildBuildingRig(cardId, teamSide(side))` and bakes it with the troop key `<id>:<team>:<edition>:<palette>`. The HP bar sits at `rig.barY` and the cannon's `rig.barrel` is the node `updateTower` aims. `trackTeam` repaints the team slot on a palette change. The hand-built cannon, `buildTombstoneMesh` and `buildCollectorMesh` are gone. The bake leaves merged meshes non-casting, so the building's opaque meshes are set to cast into the static shadow map, as the old meshes did. Checked by eye in a battle in both editions and both palettes (cannon aims and fires, tombstone spawns, collector, bars, team slots). Two new tests in troops.test.ts cover the bake, the slot colour per viewer team, the bar height, the barrel and the repaint.
  - 4: the deploy countdown ring wears the unit's team colour (`fxTeamColor`: viewer-relative and colour-blind aware), no longer opaque white.
  - 5: building and tower damage numbers start at their HP plate (`view.hpGroup.position.y`), not at 2.4 inside the keep. Tower hits still print 1.3x.
  - 7: `damagePopup(..., e.id)`, so only hits on the same target merge.
  - Already in from the cast-kit merge: 2 (cardwaveFx checks `troopFlashTint` <= 0.35) and 6 (MAX_FLASH and FX_MAX_FLASH are both 0.25).
- Review minor (the smoke ribbon read as a dark rope): `ribbon-puff` alpha 0.6 -> 0.4, and the fireball's embers trail is a warm grey 0x8a7a6e instead of 0x6e5a4c. Half-size spacing is unchanged. Burst captures of wizard, baby dragon and firecracker shots on the Golden Age court show no dark rope. The taper (older puffs smaller or faster) and an unoutlined ribbon cell are not done.
- Size: initial JS `index-*.js` 331.3 KB gz, +8.5 KB over the cast-kit merge and +37.2 KB over art/base (294.1). That leaves about 12.8 KB of the +50 KB budget for art/towers. dist/ is 2.8 MB.

perf-budget after the merge (`?quality=high`, training-camp, dev server, cast measured in every run). Gates: empty <= 220 calls, fight <= 450 calls.

| View | Edition | Empty calls / tris | Fight calls / tris | Fight textures |
|---|---|---|---|---|
| 390x844@2 | Classic | 176 / 202,978 | 252 / 577,990 | 65 |
| 390x844@2 | Golden Age | 170 / 191,770 | 260 / 593,066 | 64 |
| 1440x900@1 | Classic | 178 / 226,100 | 256 / 601,324 | 65 |
| 1440x900@1 | Golden Age | 176 / 207,666 | 268 / 609,166 | 64 |

The empty battle is the same as after cast-kit. The fight changes by -3 to -6 calls and +7k to +10k triangles (the modelled projectiles and FX). The perf fight has no card buildings. A cannon, tombstone or collector bakes to at most six meshes plus its ink (the old hand-built ones had five to eight).

Still open for the final integrator:
- Creatures-fx request 3, one material module: point `cast/bake.ts` and the `RIG_*` constants in characters3d.ts at `look/material.ts` (ramp, rim, ground shading, ink 1.6 px at 0.3 depth, saturation 1.12, mix-only tints), and tie `RIG_RIM_UNIFORM` to the cast's `RIM_UNIFORM`. Unbaked `toon()` (tower bits, arena props, non-humanoid portraits) still uses C's coloured ramp. This goes with the OUTLINE_CSS_PX 1.25 -> 1.6 unification already listed above.
- Creatures-fx request 8: decide on a colour-blind enemy hue for the Golden Age (about 300 degrees, clear of its gold and sandstone), or accept the orange. teamColors.ts is cast-kit's file.
- Ribbon polish (review minor, rest): taper the ribbon toward its tail and consider an unoutlined soft cell for ribbon puffs.
- With art/towers: tower damage numbers read `view.hpGroup.position.y`. If the towers merge moves the plate off the root's y or into a sub-group, pass the tower's top explicitly.
- The cast-kit lean (troops.ts `leanNode`) now applies to the procedural creatures. Buildings have no lean.

Screens (looked at, against /tmp/claude-0/proto/baseline/), all in /tmp/claude-0/art/ship-creatures-fx/:
- Dev standard scene: dev-{classic,golden}-{phone,desk}-battle.png.
- Card buildings in battle: dev-bld-{classic,golden}-phone-battle[2].png (zoomed: zoom-bld-*.png) and the colour-blind palette dev-bld-{classic,golden}-cb-battle[2].png.
- Fireball ribbon and tower hits: fire-burst-sheet.png, fire-zoom-sheet.png, fire2-burst-sheet.png.
- Production build: prod-{classic,golden}-{phone,desk}-{home,start,battle}.png.
- No page or console errors in any capture, and no failed requests in production.

### 4. towers

`art/towers` merged with --no-ff on top of creatures-fx. No conflicts: it touches only its own files (towers.ts, towerCraft.ts, towerStyles.ts, towerCollapse.ts, their tests and its notes).

- Wired (scene3d.ts): the Battle3D constructor calls `setTowerCrewProvider(castTowerCrews)`. That provider is cast-kit's `towerCrewProvider` with one change: `make` returns null unless `castActiveForBattle()`. Towers are built on the first sync after the battle latches its roster, so a battle that fell back to the procedural roster keeps the hand-built crews, even if the pack lands a moment later.
- Integration fix-ups (towers.ts, animate.ts):
  - Tower damage numbers start at the HP plate again. The towers float the plate toward the camera, so `hpGroup.position.y` was about 3 world units above where the plate shows. `placePlate` now stores `popupY`, the height above the tower's foot where the plate shows on screen. animate.ts reads it and falls back to `hpGroup.position.y` for card buildings. This closes the creatures-fx item "tower damage numbers read hpGroup.position.y".
  - A provider crew registers its one mesh through `registerTroopCaster`. It casts on the top level and stops casting below it, like a field troop, so the static shadow map of L1 to L4 never freezes a crew's pose. The hand-built crew still casts no shadow.
- Towers notes: the qubba line under Decisions now gives the shipped sizes (review minor).
- Towers requests:
  - 1 (crew provider): done, see above.
  - 3 (crew shadows): done, as a registered caster (see above).
  - 4 (no change needed): the plate keeps its glossy pill. Measured: the empty battle is down 64 to 74 calls.
  - 2 (shadow cost): not changed. On the top level the shadow map re-renders every frame for the troop casters (post.ts `dynamicShadows`), so the static keeps are drawn twice per frame. The lower levels already render the map on demand. Measured: empty 251k to 274k triangles, under the 300k gate but above the 260k target at 1440x900. The fix (a split static/dynamic shadow map, or keeping the keeps out of the per-frame pass) goes to the final integrator.
  - 4 (far king at landscape sizes): open, for the final integrator. It needs extra top margin in wide mode (`WIDE_BOX` in fit.ts and layout.ts, compact-hand's framing). At 1440x900 the far king's roofs are cut in both editions, and his plate flips under his gate. Before this merge his roofs were cut there too.
  - 5 (`?viewpoint=enemy` in bot battles): open. It needs main.ts outside the battle-start gate exception.
  - 6 (far king plate with the cast's taller king), re-checked on 390x844 in the dev build and the production build:
    - Classic: the plate sits above the canopy, with 5.1 CSS px to spare under the HUD inset.
    - Golden Age: the plate misses by 0.5 px, so it flips under his gate, where flyers pass (a baby dragon covered the number in one capture).
    - Open, for the final integrator. Options: let far plates rise into the gap between the scoreboard chips and the clock (layoutWire passes a smaller plate inset), or lower the qubba by about 2 px. A 0.5 px tweak would only move the problem to the next phone size.
- Gate checks (dev server, phone):
  - Pack in before the tap: 6 cast crews in both editions.
  - Pack held back 15 s: the battle starts on the procedural roster with hand-built crews. After the pack lands there are still 0 cast crews, and a wave spawned then is procedural too.
- Size: initial JS `index-*.js` 339.1 KB gz. That is +7.8 KB over the creatures-fx merge and +45.0 KB over art/base (294.1), so about 5 KB of the +50 KB budget is left. dist/ is 2.9 MB.

perf-budget after the merge (`?quality=high`, training-camp, dev server, cast measured in every run). Gates: empty <= 220 calls, fight <= 450 calls.

| View | Edition | Empty calls / tris | Fight calls / tris | Fight textures |
|---|---|---|---|---|
| 390x844@2 | Classic | 102 / 251,230 | 180 / 626,446 | 76 |
| 390x844@2 | Golden Age | 106 / 256,182 | 200 / 657,694 | 75 |
| 1440x900@1 | Classic | 106 / 274,378 | 183 / 649,522 | 76 |
| 1440x900@1 | Golden Age | 114 / 272,102 | 204 / 673,398 | 75 |

Against the creatures-fx merge:
- Calls: empty -64 to -74 (one mesh per keep, one skinned draw per crew); fight -60 to -73.
- Triangles: +48k (Classic) and +64k (Golden Age). Most of it is the detailed keeps drawn twice under per-frame shadows (request 2 above).
- Textures: +11 in the fight. That is the roof tile, crack and zellige sheets, plus the crews' atlases and bone textures.

Still open for the final integrator (in addition to the lists above):
- Towers requests 2, 4, 5 and 6, as above.
- The Golden Age tower-king turban (cast-kit item above) now shows in battle. At phone size it reads white with shading and no visible halo. The bloom probe is still to do.

Screens (looked at, against /tmp/claude-0/proto/baseline/), all in /tmp/claude-0/art/ship-towers/:
- Dev standard scene: dev-{classic,golden}-{phone,desk}-battle.png.
- Zooms: zoom-{classic,golden}-phone-{far,near}.png and zoom-golden-phone-{far,near}king.png.
- Tower damage numbers at the plates: hp-sheet-classic.png (zoom-hp-{far,near}.png) and hit-sheet-{a,b}.png.
- Slow pack: dev-classic-phone-slowpack[-wave].png.
- Production build: prod-{classic,golden}-{phone,desk}-{home,start,battle}.png.
- No page or console errors in any capture, and no failed requests in production.


### 5. ship (final integration, branch `art/ship`)

`art/ship` was cut from the live branch at `29f6451`, after the four per-package shippers above. It merges nothing: it wires what was left, unifies the material constants, tunes, adds the budget tooling and the offline cache, writes the licences, and runs the full verification matrix. Details and the progress log: `notes/features/art-ship.md`.

WHAT EACH PACKAGE DELIVERED (as shipped)
- stage: calm per-look floors (no checkerboard), the light rig from `sky.ts` (sun from the upper left, shadows fall right), bloom and grade under the contract, pebble-edged paths and recessed river with a bridge per BridgeStyle, the tournament court (kerb, team bleachers, chibi crowd that waves and jumps, pavilions), the far band (gate, terrace, pennants), a village or town outer ring on wide screens, the Golden Age court and souk, and the five-level quality ladder.
- cast-kit: the CC0 KayKit cast for every humanoid card and the tower crews in both editions (one skinned draw per unit with its ink, team cloth front and back, Golden Age overlays, champion, procedural mounts), the 14 degree render-only lean, swarm pose sharing, card portraits from the same models, and the 0.8 MB pack.
- creatures-fx: the procedural creatures and card buildings in the cast's material language (one team slot each), gold outlined damage numbers that merge per target, bloom-safe toon FX, modelled projectiles, team spell rings, deploy countdown in team colour, hit-stop and shake.
- towers: one-mesh keeps with silhouette ink for both editions and all 22 looks (cone roofs or domes in live team colour, per-look extras, flair tiers), HP plates clear of roofs and crew, two damage stages, the chunked collapse and ruin, and the crew provider seam.
- ship: the integration below.

SEAMS AND UNIFICATION
- Already wired by the per-package shippers and checked here: the crew provider (6 cast crews in every capture with the pack in), the battle-start cast gate (fresh-profile tutorials that start before the pack run on the procedural roster for the whole battle, with no mixing), the crowd events.
- `troopShadowLevel` reads `QualityLevel.troopShadows` (the last stopgap).
- `src/render3d/look/material.ts`: the toon ramp, rim (one shared live uniform for cast and rigs), ink (#1F1A2E, 1.6 CSS px, 0.3 depth; plain hulls were 1.25 px), ground occlusion, saturation, tint cap and the 0.35 / 0.25 / 0.25 flash caps, with the ramp, rim and roll-off GLSL. The cast, rigs, shared ink, keeps, hit flashes and screen flash read it (`look/material.test.ts`).
- Dead paths removed: `kitTroops.ts` (the prototype's re-export, no importers), the unused name-label sprites and `view.label`, `EntityView.kitCrew`, the per-entity `setLeanCamera`.

TUNING (fix-up rights)
- Bloom: lit cast and rig pixels roll off from 0.8 to at most 0.9 linear luminance, under the 0.92 threshold. Measured on screen: janissary bork 0.94-0.96 -> 0.80-0.815, Golden Age tower-king turban #FFFFFF -> 0.861 (cast-kit review minor and stage request 4).
- HP plates: a plate short of room slides toward its tower within the 4 px floor before it flips. The Golden Age far king's plate on a 390x844 phone now stays over his qubba (towers request 6).
- Stage request 3: sun-offset blob shadows on L1-L4 (0.32 of the unit's height along `SHADOW_SLOPE`, stretched along it).
- Golden valkyrie: her keffiyeh hem ends at 1.56, so both braids show from behind (cast-kit review minor).
- Golden Age Giant (war elephant): rig scale 1.48 -> 1.3, off the whole bridge.
- Smoke ribbon: tapers toward its tail (creatures-fx review rest; the unoutlined cell was not needed).
- Checked by eye and kept: crew scale (0.72), team disc and notch, the 14 degree lean, grade and bloom, the Golden Age overlays by the Golden Age towers, and the hat-height exception (signed off).
- Colour-blind Golden Age enemy hue (creatures-fx request 8): kept orange (reasons in art-ship.md).

BUDGETS
`npm run perf:budget` (`tools/perf-budget.mjs --matrix`: both editions at 390x844@2 and 1440x900@1, `?quality=high`, training-camp, cast measured in every run). Gates: empty 220 calls / 300k triangles; fight 450 calls / 850k triangles / 110 textures. Targets: empty 200 / 260k, fight 400 / 750k.

| View | Edition | Empty calls / tris | Fight calls / tris | Fight textures |
|---|---|---|---|---|
| 390x844@2 | Classic | 100 / 251,206 | 179 / 628,230 | 76 |
| 1440x900@1 | Classic | 106 / 274,378 | 184 / 651,446 | 76 |
| 390x844@2 | Golden Age | 106 / 256,182 | 200 / 653,650 | 75 |
| 1440x900@1 | Golden Age | 114 / 272,102 | 204 / 669,354 | 75 |

Every gate passes. Every target is met except the empty-battle triangles at 1440x900 (274k and 272k against 260k), see Known gaps. At art/base (`b7ae4ce`, the towers notes' start figures) the same measure read empty 167-178 calls and fight 402-432 calls; the art round roughly halved the draw calls (one draw per keep, per crew and per cast unit).

SIZE AND OFFLINE
| Build | `index-*.js` gz | `three-*.js` gz | lazy chunks gz | dist/ |
|---|---|---|---|---|
| `0a8c97d` (before the art round) | 283.9 KB | 157.2 KB | glbModels 22.4 KB | 12.95 MB (11.0 MB `public/models/kaykit`) |
| `ed45f9c` (live, compact tray, before any art) | 284.6 KB | 157.2 KB | glbModels 22.4 KB | 12.95 MB |
| `b7ae4ce` (art/base: + handcrafted-plus) | 294.1 KB | 157.2 KB | | 12.97 MB |
| `29f6451` (four packages merged) | 339.2 KB | 157.9 KB | GLTFLoader 13.2, meshopt 7.3 | 2.88 MB |
| `art/ship` | 324.0 KB | 157.9 KB | roster 16.7, GLTFLoader 13.2, meshopt 7.3 | 2.88 MB (0.81 MB cast) |

- Initial JS (index + three) grew +40.1 KB gzipped over the pre-art live build `ed45f9c` (+30.6 over art/base): inside the +50 KB budget. Before the lazy roster it was +55.3 over `ed45f9c`.
- The cast pack is 803 KB on disk (at most 1.0 MB), served gzipped by the relay; the roster chunk, GLTFLoader and the meshopt decoder ride in with it after boot. No outer-ring props were packed (the outer ring is procedural).
- `public/sw.js` precaches the seven cast files per BUILD_ID at install (best effort per file) and serves `/models/` cache-first with no background refetch.
- `docs/deploy-multiplayer.md`: a first visit is about 1.4 MB (0.55 MB code, then 0.85 MB of characters in the background).
- Fast 3G, fresh profile, production build: the pack finished at 17.6 s (Classic) and 19.2 s (Golden Age) after navigation, before the tutorial battle started (25.1 s and 27.9 s; boot is slow under software GL), so the pack had landed before the gate looked. A returning profile on Fast 3G had the pack by 8.6 s and its first battle at 21.4 s. The gate's other branch (pack later than 3 s after the tap: procedural roster for the whole battle, no mixing) was checked by the cast-kit and towers shippers with the pack held back 15 s.

LICENCES
- `THIRD_PARTY_NOTICES.md`: the two CC0 KayKit packs (URL, version commit, SHA-256 of every shipped file; source-file hashes in `public/models/troops/CREDITS.txt`), the OFL fonts and the MIT libraries.
- README: an "Assets and licences" section. `src/app/assets.test.ts` checks that every `public/models/` folder has a CREDITS.txt with a source URL, CC0 and SHA-256, and that the notices name every shipped file.

VERIFICATION MATRIX (every image looked at; all in `/tmp/claude-0/art/ship/`)
- Standard matrix, 4 looks x 2 editions x {390x844@2 high, 1440x900 high, 390x844@1 low}: `matrix/`.
- All 22 looks at 1440x900: `looks/` plus the four in `matrix/`; contact sheets `looks-sheet-classic.png` and `looks-sheet-golden.png`. No missing pieces in any look.
- L0 / L2 / L4 phone per edition, `?viewpoint=enemy` (flipped through `__cr` after the battle start, see Known gaps), 360x640, 768x1024 and 844x390, the home diorama (phone and desk), the tutorial battle, a tower destroyed (collapse, ruin), the king KO and Victory, the colour-blind palette, sunset (`?sky=0.6`) and night (`?sky=1`): `extra/`.
- Production build on the relay (`npm run build:all`, served by `dist-server/relay.mjs`): home, battle start and battle after played cards, Fast 3G fresh profiles, and a real online "Play a friend" match with host and guest screens in both editions: `prod/`.
- No page errors, console errors or warnings, and no failed requests in any capture (dev captures use a git-ignored `server.fs.allow` wrapper so the fonts load: the worktree's `node_modules` is a symlink).
- What a parent sees at phone size, in both editions and in all four showcase looks: whose tower and troop is whose at a glance (team roofs, cloth and discs); your own troops read from behind (hats, hair, weapons held out, team capes); no name tags, haze or white blobs (the only white glow is the bot's emote bubble); a calm floor; a dressed far band and sides; the compact tray leaves the board clear.
- Owner sheets: `before-after-phone.png` (four looks per edition, baseline `0a8c97d` against the final) and `before-after-desk.png` (training-camp at 1440x900, both editions).

KNOWN GAPS AND FOLLOW-UPS
1. Real-device fps on a mid-range Android phone and an iPad (owner follow-up; SwiftShader timings say nothing).
2. Far king at landscape sizes (1440x900, 844x390): his roofs are cut at the top of the frame and his plate flips under his gate (towers request 4). The fix is extra top margin in wide mode (`WIDE_BOX` in `scene/fit.ts` and `ui/layout.ts`), which is the compact-hand framing and frozen for the art round: a request for that owner.
3. `?viewpoint=enemy` (DEV aid) is reset by every bot-battle start in main.ts (towers request 5; main.ts is frozen outside the gate). The real guest view was verified through an online match on the production relay.
4. Empty-battle triangles at 1440x900 are 272k-274k, over the 260k target (gate 300k): at L0 the shadow map re-renders every frame for the troop casters, so the static keeps are drawn twice (towers request 2). Fix: split the static and dynamic shadow maps.
5. Unbaked `toon()` parts (arena props, the hand-built crews of a procedural-roster battle, non-humanoid card portraits) keep the handcrafted coloured ramp, not `look/material.ts`'s.
6. The cast's ink is opaque (it shares the body's draw); the bible asks for 85% alpha.
7. From cast-kit: the Studio preview (src/ui, frozen) uses the procedural champion; mounts gallop procedurally and their heads are blocky from the front.
8. A fresh profile's first tutorial battle on a slow device can start before the pack (by design it then plays the procedural roster for that whole battle).

HOW TO A/B
- `?troops=rigs` (dev server only): the procedural roster instead of the cast.
- `?quality=high|medium|low`, `?sky=0..1`, `?arena=<id>`, `?viewpoint=enemy` (DEV, see gap 3).
- Before/after: build `0a8c97d` in a throwaway worktree (`git worktree add --detach <dir> 0a8c97d`).

## Art bible

TOY TOURNAMENT: ART BIBLE (Crown Rush, both editions, all 22 arena looks)

0. PILLARS (the tie-breakers for every decision)
1. Team at a glance. Red and blue live ONLY on roofs, trim, banners, troop cloth (cape, mantle, hood, tabard) and the team discs.
2. Silhouette over detail. What a kid can read at 40 px on a phone wins, from the front AND from behind.
3. One material language. Troops, creatures, towers, big props and FX share:
   - one toon ramp;
   - one rim light;
   - one ink weight;
   - one sun direction.
4. Calm floor, loud actors. The ground stays low-contrast so units and towers pop.
5. Crisp to the far king. No haze or tilt-shift over the court. Fog starts beyond the far band.
6. Judge by eye at phone size, side by side with the baseline. If it is not clearly better on a 390x844 phone, it is not done.

1. CAMERA AND FRAMING
- Keep the orthographic camera (CAM_HOME 0,30,26, about 49 degrees) and the compact-hand framing (alignY 0.6). Do not change the camera pitch: hit-testing, fit.ts and the layout tests depend on it.
- Characters (kit cast and procedural creatures) LEAN 14 degrees toward the camera. This is render-only and tunable:
  - the pivot is at the feet;
  - the axis is perpendicular to the camera's horizontal view direction, so it works for the guest viewpoint and the swaying home diorama;
  - the disc, contact shadow and HP bar do not lean.
- Kit heads are scaled up 12%.
- Phone far band: the compact tray moves the board down, which opens about 60-100 px above the enemy king on 390x844. That band is now on screen and gets art: the tournament gate, a crowd terrace and pennants. The HUD chips sit on top of it, so no critical detail goes under the scoreboard.

2. TOWERS (C's castles, made production-ready)
Classic princess tower:
- a square ashlar keep on a stepped plinth with a battered base;
- corner quoins and arrow slits;
- an arched timber gate on the camera face;
- a corbelled parapet with merlons;
- four bartizan turrets under smooth team-colour cone roofs with gold finials:
  - at least 16 segments with smoothed normals and a painted tile texture;
  - no faceted pie-slice shading;
- a team trim band at the parapet and the plinth top;
- a team banner on the camera face.
All four faces are modelled, because the online guest sees the back. The deck and crew must read from both viewpoints.

King tower:
- a wider keep, with four corner turrets plus a central team-colour canopy over the king's dais;
- a banded cannon and a gold crest;
- the king stands under the canopy and must read as a face plus a crown. The crown is a band with 5 short points, never a radial "sunflower". He wears a team cape.
Crew:
- KayKit crew in team hood or cape, 25-30% smaller than in the B prototype (about 0.75 of a field archer);
- stands INSIDE the crenellations, with the head and weapon above the parapet;
- cannoneer and duchess crews follow the same rule.
HP plates:
- enemy towers: above the tallest roof tip;
- player towers: under the gate foot;
- never overlapping the crew or roofs, with at least 4 px clearance at 390 px wide.
Ink: silhouette-only (a depth-pushed hull with smoothed normals, 1.6 px). No fins, and no ink on bricks or windows.
Damage stages:
- Stage 1 (HP below 70%): crack decals on two faces, one merlon chipped.
- Stage 2 (below 40%): two more merlons gone, a missing patch of roof tiles, a torn banner, one smoke wisp.
- Destroyed: the tower collapses in 3-4 chunks (roofs, turrets, upper keep) with dust. It leaves a ruin: a jagged broken stump, a rubble mound, a scorched ground ring and the fallen banner. No grey disc, and no darkening the whole tower to mud.
- King: the wake beat (cannon rises, king stands). The KO and victory flow stays as it is.
Flair tiers (600 and 1200 trophies, setTowerFlair):
- gilded: gold trim and gilded finials;
- jeweled: a gem crest and gold roof bands.
Golden Age:
- the same massing in sandstone or marble ashlar per look;
- team-colour bulbous domes (at least 12 segments, smoothed) on the turrets, and a larger dome canopy over the king;
- a horseshoe-arch gate, stepped Moorish merlons, a zellige band at the parapet (THEME turquoise and gold) and gilded finials, reusing the edition's existing dome and finial language.
- Same damage and collapse stages.
Per look:
- stone comes from look.tower.enemy and look.tower.player (BrickVariant);
- plinth, battlement and platform colours come from the look;
- look-specific extras sit in towerStyles.ts:
  - snow caps: snow, ice, atlas;
  - ember-glow cracks below the bloom threshold: forge, copper;
  - vines: jungle, ghouta;
  - neon edge strips: neon;
  - bone lintels: bone.
- Roof and dome colour is ALWAYS the team colour from teamColors, including the colour-blind palette.

3. GROUND
Classic grass:
- NO checkerboard. Wide mow stripes across the board, 2 tiles each, at plus or minus 3% lightness;
- large soft value noise (8-tile scale, plus or minus 4%);
- sparse clover and flower specks kept away from the lanes;
- instanced grass tufts (top three quality levels);
- painted ambient occlusion darkening at the kerb foot and around tower plinths.
- The deploy grid appears only while dragging (existing behaviour).
Paths: packed warm dirt with C's pebble edging, darker worn edges and faint ruts, plus flagstone aprons under the tower plinths.
River:
- a recessed channel with sandy banks, reeds and lily pads;
- brighter foam at the banks;
- the river continues through the surround.
Bridges by BridgeStyle:
- timber: C's planks, posts and rope;
- stone: an arch with a parapet;
- ice: a slab with frost rim;
- gate: a small gatehouse.
Band kinds:
- water: sand banks;
- lava: basalt lips, glowing seams below the bloom threshold except the core;
- ice: snow banks;
- chasm: cliff lips with depth falloff;
- neon: chrome lips.
Per-look floor recipes (the floor palette and scatter style drive them):
- swamp: mossy, with puddles;
- bone: sand with bone scatter;
- snow: soft drifts with sparkle;
- forge: basalt plates with ember seams;
- mystic: violet moss with crystal flecks;
- workshop: packed earth with plank inlays;
- royal: pale lawn with gold-edged paths;
- ice: blue-white sheet with cracks;
- jungle: deep green with leaf litter;
- neon: pale tiles with glow seams.
Golden Age floor:
- courtyard flagstones (plaster or sandstone) with zellige border bands;
- floor emblems kept but at no more than 25% of today's contrast and smaller, so they never compete with units;
- lanes of packed ochre sand with pebble edging;
- a canal with a tiled lip;
- palettes come from ISLAMIC_LOOKS[...].islamic.

4. SURROUNDINGS
Inner ring (visible on phones):
- a kerb of dressed stone with team-colour post caps;
- far band: the tournament gate, a crowd terrace and pennants;
- near band: your terrace and gate.
Long sides (tablet and desktop):
- stepped team bleachers;
- an instanced chibi crowd, replacing C's pawns:
  - head, body and arms; 6 skin tones; 8 shirt colours biased toward the side's team colour;
  - they bob, and wave or jump on tower hits and crowns;
  - 2 instanced draws; animation off from L3 down;
- striped team pavilions and pennants.
Outer ring (wide screens only, culled when off-screen on phones):
- Classic green looks (meadow, swamp, jungle, workshop, royal): a village edge with cottages, a windmill, market stalls, an orchard and forest. Build it from KayKit Medieval Hexagon props (A's tools/kit-pack.mjs, pruned, at most 300 KB) or procedurally; the stage owner picks by eye.
- snow and ice: chalets and snowy pines (palette swap);
- bone: dead trees and rock spires;
- forge: basalt cliffs and forges;
- mystic: crystal spires;
- neon: lit city blocks.
- Golden Age: arcaded galleries (horseshoe arches) hold the crowd instead of bleachers, team-striped souk awnings replace the pavilions, plus palms, domed flat-roof houses and lanterns. Night looks (souk, medina, copper) keep their light pools.
- The existing backdrop kits (kits.ts, backdrop.ts) are re-materialled into the shared ramp. They are not rebuilt unless they look wrong next to the new set.

5. LIGHT, SHADOW, GRADE
Lights:
- Sun: from the player's upper-left, so shadows fall to the lower-right on screen; warm (about #FFEDC8); elevation about 50 degrees; intensity 1.6-1.8.
- Hemisphere: cool sky, grass-tinted ground.
- A cool back-rim light on characters and a 0.3 fill from the camera side.
- Every package reads light from sky.ts. Nobody hard-codes light directions.
Shadows:
- L0: a 2048 PCFSoft shadow map. The static set renders on demand; troops cast every frame, with ONE caster per unit.
- L1-L3: static shadow map only; troops get a sun-offset blob shadow.
- L4: no shadow map; painted occlusion plus blobs.
Grade:
- saturation about 1.12 and contrast 1.06;
- a subtle split tone: shadows toward (0.96, 0.98, 1.04), highlights toward (1.03, 1.0, 0.96);
- vignette at most 0.24;
- no tilt-shift, and no depth haze over the court.
Bloom contract:
- linear luminance threshold 0.9 or higher, strength at most 0.35, radius about 0.3;
- only emissive cores exceed 1.0: fireball and comet cores, sparks, elixir, lanterns and neon at night;
- albedo and hit flashes on troops and towers must never cross the threshold.
- Screen flash (setFlash) is capped at 0.25.
Day/night: sunset, overtime and night grading stay as they are.

6. TROOP RENDERING
Humanoids:
- CC0 KayKit bodies (Knight, Barbarian, Mage, Rogue, Rogue_Hooded, Skeleton_Minion and Skeleton_Warrior), each baked to ONE skinned draw with its ink shell;
- each card is a variant: hat, cape, weapon, borrowed props, a few primitive props, and a palette;
- Golden Age is an overlay on the same rigs (turban helmets, keffiyeh-style hoods, scimitars, börk hats, sashes, edition palette), mirroring what each Golden Age unit already wears and carries today.
Scale (head-top height in world units):
- swarm: 1.6-1.9
- standard: 2.3-2.7
- large (giant, P.E.K.K.A, mega knight): 3.3-3.8
- the giant is at most 1.3 tiles wide on a 390 px phone and must not cover a whole bridge.
Shading (starting values; the integrator owns final tuning):
- a 3-band toon ramp at 0.62, 0.86 and 1.0 with soft 0.04 edges;
- cool rim #BFE3FF at 0.35, off at L4;
- albedo saturation 1.12;
- ground occlusion: the lowest 18% of the unit is darkened by up to 15%.
Ink: #1F1A2E at 85% alpha, 1.6 CSS px (fitInk). Characters, creatures, towers and big props only. Off at L4.
TEAM RULE (all cards, both editions):
- team colour goes ONLY on the largest back-visible cloth (cape, mantle, hood or tabard), plus the team disc;
- signature colours are fixed per card and never change with team;
- no signature colour may fall in either team hue family: within 25 degrees of a team hue, at saturation above 0.45 and lightness 0.25-0.75. So no navy enemy Mini P.E.K.K.A., no blue Minions, and no wizard hat that flips colour.
- Team colour is a live uniform or palette row, so changing the team or colour-blind palette repaints units that are already on the field.
Back-readability: every card has at least 2 back-visible silhouette features (a weapon held outside the body outline, a distinct hair, hat or helmet shape, a quiver, backpack or cape cut). No hood marks as identity.
Animation:
- idle, walk or run, and an attack whose blow is locked to the sim attack timer;
- walk clip speed matched to ground speed, so feet do not slide;
- a light hit react, then Death_A, then the existing death FX;
- freeze: ice tint and the mixer paused;
- mixer rate by quality level: 60 Hz (L0-L1), 30 Hz (L2-L3), 20 Hz (L4);
- swarms (6 or more units of one card) share one pose per card per side.
Hit flash: a mix toward #FFF4E0 of at most 0.35 for 80 ms on troops, 0.25 on towers. It never blooms.
Field UI:
- NO floating name tags;
- troop HP bars appear only when the unit is damaged: team-tinted fill, 2 px dark outline, level pip, placed clear of the head;
- team discs are thicker and more saturated, and keep the enemy notch cue for colour-blind players.
Card portraits (hand, Next, collection, studio, deck): rendered from the same models, knee-up, 3/4 front, per edition.

7. CREATURES AND BUILDINGS (procedural, restyled to the same language)
- Same ramp, ink, flash and lean as the cast. Big simple shapes.
- Team colour on ONE cloth or trim slot only: scarf, saddle, envelope stripe, collar, pennant or wreath.
- Classic: baby dragon (green, team scarf), balloon (team stripe on the envelope, kit-style pilot), bats (violet), minions (purple-grey with a team bandana, never blue), gargoyles (stone with a team collar), stone golem and pebble golem (rune glow below the bloom threshold), skeleton barrel, comet rock.
- Golden Age: war elephant (team saddle cloth), fire kite, roc hatchling, war falcon, sandstone golem, sand pebble.
- Buildings: cannon (bronze, team pennant), tombstone (team wreath), elixir collector (team trim).
- Mounts for hog rider, prince and camel raider: procedural animals built by the cast package in the same language.

8. VFX
- Same palette logic and outline language as the characters. Toon flames in 3 tones.
- Puffs are outlined and tinted (dust takes the floor colour); never opaque white.
- Impact puffs are at most 1.2 tiles for single-target hits.
- Hit sparks: 4-6 star sprites.
- Projectiles are modelled:
  - fireball: an emissive core, 3 flame petals and a smoke ribbon, never a cone;
  - arrows with fletching;
  - musket tracers;
  - ice and electro bolts.
- Spell areas: rings in the caster's team colour with a white inner rim.
- Damage numbers: Lilita One, gold fill #FFD23F, a 3 px #1D1630 stroke and a soft drop shadow. Crits and tower hits are larger. Hits on the same target within 150 ms merge, and numbers stack so "160" and "80" never overlap. The Golden Age edition keeps its digits.
- Particle counts follow particleScale().

9. EDITIONS AND THE 22 LOOKS
Every visual system reads its colours from ArenaLook and teamColors; per-look geometry choices live in small switch tables owned by each package. Required showcase set (screenshots by every package):
- training-camp: meadow / courtyard
- barbarian-bowl: snow / souk
- pekka-playhouse: forge / copper
- legendary-peak: neon / medina
The other 14 looks must render correctly with no missing pieces (contact sheet). Night-native looks keep their light pools. Golden Age gets its own towers, cast overlays, court and outer ring. It never falls back to old dolls or flat towers.

10. ASSETS, LICENCES, DOWNLOAD
- KayKit Adventurers Character Pack 1.0 and KayKit Skeletons Character Pack 1.0 (Kay Lousberg, CC0 1.0): character meshes, the palette texture and the Rig_Medium clips, packed by tools/troop-pack.mjs into public/models/troops/.
- KayKit Medieval Hexagon Pack 1.0 (Kay Lousberg, CC0 1.0, github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0): OPTIONAL outer-ring props only, packed by tools/kit-pack.mjs into public/models/kit/.
- Everything else is procedural: towers, ground, river, bridges, surround, crowd, creatures, mounts and FX.
- Fonts already in the project: Lilita One and Baloo Bhaijaan 2 (OFL).
- Meshopt decoder: ships with three, MIT. gltfpack (MIT) may be used as a dev-time tool via npx.
- No other external art without the integrator's sign-off. No Supercell or Clash Royale assets, logos or likenesses.
- Each asset folder has a CREDITS.txt with the exact source URL, version, licence and the SHA-256 of each source archive. The repo root gets THIRD_PARTY_NOTICES.md.
Download budget (bytes transferred, compressed):
- troop pack at most 1.0 MB, loaded at app boot and cached by the service worker;
- outer-ring props at most 0.3 MB, wide screens only;
- initial JS bundle grows by at most 50 KB gzipped;
- the 11 MB public/models/kaykit folder, glbModels.ts, modelsOptIn.ts and ?models=kaykit are deleted;
- a battle never waits more than 3 s for models. If they are not ready, the WHOLE battle uses the procedural roster. Never mix the two mid-battle, and never pop in.

11. PERFORMANCE AND THE QUALITY LADDER
Measured by tools/perf-budget.mjs at 390x844@2, ?quality=high, first arena, both editions, and also at 1440x900. Hard gates and targets:

| Measure | Hard gate | Target |
|---|---|---|
| Empty battle, draw calls | 220 | 200 or fewer |
| 12-card fight, draw calls | 450 | 400 or fewer (headroom for Skeleton Army) |
| Empty battle, triangles | 300k | 260k |
| 12-card fight, triangles | 850k | 750k |
| Textures in the fight | 110 | — |

Per unit: 1 draw for a kit troop, plus 1 shadow caster at L0. Creatures stay within the rigBake MESH_BUDGET and SWARM_BUDGET.
Ladder, mapped onto the existing five levels:
- L0 (high): DPR up to 2, full bloom, 2048 shadows with dynamic troop casters, FXAA, ink, rim, crowd animation, outer ring, tufts, 60 Hz mixers.
- L1: half-resolution bloom, static 1024 shadows, sun-offset troop blobs.
- L2 (medium): bloom off, DPR up to 1.5, particles 0.75, static crowd, 30 Hz mixers.
- L3: lower pixel budget, particles 0.5, outer ring and tufts hidden.
- L4 (low): no shadow map, FXAA, rim or ink; 20 Hz mixers; swarms share poses.
L4 must still look finished: painted occlusion, blobs, and the same colours and silhouettes.
Troop shadow casting follows the LIVE quality level (no frozen shadows after the governor steps down).
SwiftShader timings are not representative: gate on the counters. Real-device fps checks (a mid-range Android and an iPad) are listed as an owner follow-up.


## Packages


### cast-kit (wave 1): Modelled cast: KayKit characters for every humanoid card and tower crew, both editions, with lean, team rule, animation and card art

**Start from:** Shared wave-1 base: proto/handcrafted-plus at 52a1c29.
1. Create the worktree:
   git -C /home/user/clash-royale-clone worktree add /home/user/wt-art-cast-kit -b art/cast-kit 52a1c29
2. Link node_modules:
   ln -s /home/user/clash-royale-clone/node_modules /home/user/wt-art-cast-kit/node_modules
3. Bring in B's troop work (B's own commits are 8edb8e1..49d0001):
   git checkout proto/kit-everything -- src/render3d/kitTroops.ts tools/troop-pack.mjs tools/troopview.html public/models/troops src/render3d/cardportraits.ts src/render3d/scene/views/animate.ts src/render3d/scene/common.ts
   (None of these files was touched by A or C, so B's versions apply cleanly.)
4. Hand-port B's hunks in src/render3d/scene/views/troops.ts onto C's version:
   git diff e4be8f7 49d0001 -- src/render3d/scene/views/troops.ts
   Keep C's troopShadowLevel caster logic and drop A's.
5. Do NOT take B's towers.ts hunk (the crew goes through the provider seam), or anything from proto/kit-world.

**Owns:** `src/render3d/kitTroops.ts`, `src/render3d/cast/**`, `src/render3d/scene/views/troops.ts`, `src/render3d/scene/views/troops.test.ts`, `src/render3d/scene/views/animate.ts`, `src/render3d/scene/views/animate.test.ts`, `src/render3d/scene/common.ts`, `src/render3d/anim/**`, `src/render3d/teamBase.ts`, `src/render3d/teamBase.test.ts`, `src/render3d/teamColors.ts`, `src/render3d/teamColors.test.ts`, `src/render3d/outlineMaterial.ts`, `src/render3d/outlineMaterial.test.ts`, `src/render3d/cardportraits.ts`, `src/render3d/cardportraits.test.ts`, `src/render3d/cometPortrait.test.ts`, `src/render3d/gallery.ts`, `src/render3d/dispose.test.ts`, `src/render3d/glbModels.ts (delete)`, `src/render3d/modelsOptIn.ts (delete)`, `public/models/troops/**`, `public/models/kaykit/** (delete)`, `tools/troop-pack.mjs`, `tools/troopview.html`, `notes/features/art-cast-kit.md`

#### Spec

GOAL
Every humanoid unit on the field, every tower crew and every humanoid card portrait comes from one CC0 KayKit cast (B's bake pipeline). Each must read at phone size from the front AND from behind, in both editions, under the art bible's material language and team rule.

1. STRUCTURE
- Split kitTroops.ts into src/render3d/cast/: loader.ts, bake.ts, props.ts, variants.classic.ts, variants.golden.ts, mounts.ts, animate.ts, crew.ts and index.ts.
- Keep B's API exported from cast/index.ts: hasKitTroop, makeKitTroop, animateKitTroop, makeKitGhost, loadKitTroops, kitTroopCards and disposeKitTroop. Either keep kitTroops.ts as a re-export or delete it.
- Keep every export of troops.ts, animate.ts, common.ts, teamColors.ts, teamBase.ts and outlineMaterial.ts that other files import on the base backward-compatible. You may add exports; do not change or remove existing ones. In particular keep everything towers.ts imports from ./troops and ./animate.

2. COVERAGE, CLASSIC
- knight, archers, firecracker, magic-archer, giant, musketeer, mini-pekka, skeletons, skeleton-army, wizard, witch, executioner, electro-wizard, ice-wizard, princess, mega-knight, royal-giant, valkyrie, pekka, digger;
- prince: rider plus a procedural horse in cast/mounts.ts;
- hog-rider: rider plus a procedural hog;
- champion: map every ChampionDef option onto kit props (headgear helmet, hood, crown, horns, turban; weapon sword, axe, hammer, spear, bow, staff) so the studio and its portraits work;
- every summoned humanoid: skeletons from the witch, tombstone and barrel.

3. COVERAGE, GOLDEN AGE (ARABIC)
- An overlay for every Classic humanoid the edition shows: turban helmets, keffiyeh-style hoods, scimitars, sashes and the edition palette, mirroring the existing ARABIC branches in characters3d.ts.
- The edition's own humanoids from ISLAMIC_BUILDERS:
  - janissary (musketeer), duelist (mini-pekka), war drummer (witch), alchemist (wizard);
  - cataphract (pekka), mamluk amir (mega-knight), militia (skeletons, skeleton-army), bombardier (royal-giant);
  - treasure digger (digger);
  - camel raider (hog-rider): rider plus a procedural camel.
- Mirror what each unit wears and carries today. Keep it respectful: no religious symbols on units.
- Non-humanoids belong to creatures-fx.
- Mounts are built in cast/mounts.ts in the shared material language.

4. TOWER CREWS
- tower-princess, tower-king, cannoneer and duchess, both editions, delivered as `towerCrewProvider` from cast/crew.ts per the crew contract in sharedRules. Do NOT edit towers.ts; the integrator wires it.
- Crew is 25-30% smaller than in the B prototype.
- The king reads as a face plus a band crown (5 short points, never a radial sunflower) with a team cape.

5. READABILITY (the critics' #1 fix)
- (a) Render-only lean: a lean node between the troop root and the yaw node, 14 degrees (exported const), pivot at the feet. The axis is computed from the camera's horizontal direction each frame, so the guest viewpoint and the home diorama work. The disc, contact shadow and HP bar are not leaned.
- (b) Head bone 1.12 on kit bodies.
- (c) Every variant has at least 2 back-visible silhouette features. Delete the hood 'V' marks. Archers show the bow clearly. The valkyrie gets braids and an axe held outside the silhouette. The giant gets a beard, a fringe and a wider body; the giant and valkyrie must not both read as orange balls.
- (d) Extend tools/troopview.html into a contact sheet rendered through the battle camera WITH lean: every variant, both teams, front and back, both editions, plus a 40 px thumbnail strip.

6. TEAM RULE (sharedRules)
- Enforced in data: team paint lands only on cape, mantle, hood or tabard, plus the disc.
- Signature colours are fixed and outside the team hue families. Fix B's navy enemy Mini P.E.K.K.A. and the wizard hat that flips colour.
- Team colour is a material uniform or palette row; the onPrefs hook in troops.ts repaints live units when the team or colour-blind palette changes.
- Make teamBase discs thicker and more saturated, and keep the enemy notches.

7. MATERIAL
- One skinned draw per unit, including the ink shell.
- Use the art bible's ramp, rim, saturation, ground occlusion, ink (1.6 px via fitInk) and hit flash (at most 0.35 for 80 ms; the hitFlashTint in animate.ts covers procedural rigs too; towers at 0.25). No material may cross the bloom threshold.
- Real shadows only when post.troopShadowLevel() allows, with ONE caster per unit, evaluated live (no frozen shadows after a quality step-down). Otherwise the contact blob and disc.

8. FIELD UI
- Remove floating name tags (the deploy label).
- Troop HP bars only when damaged: team-tinted fill, 2 px dark outline, level pip, offset above the variant height.

9. ANIMATION
- Idle, walk or run, and attack with the blow locked to the sim attack timer (B).
- Walk clip speed matched to ground speed.
- A light Hit_A react; Death_A, then hand over to the existing death flow in animate.ts.
- Freeze: ice tint and mixer paused. Stun. The prince's charge pose.
- Mixers at 60 Hz (L0-L1), 30 Hz (L2-L3) and 20 Hz (L4), from currentQuality().
- Swarms (6 or more of one card per side) share one pose.
- The sim stays untouched; only read entity state.

10. ASSETS AND LOADING
- Pack only the used bodies, props and clips. Add Skeleton_Warrior if needed.
- Meshopt and quantisation (gltfpack via npx, or KHR_mesh_quantization in troop-pack.mjs), with MeshoptDecoder from three/examples. public/models/troops must be at most 1.0 MB on disk.
- Start loading at app boot. Export `castReady(): Promise<boolean>` and `castActiveForBattle()`. If the cast is not ready at battle start, the whole battle uses the procedural roster. Never mix mid-battle and never pop in; the integrator wires the start gate.
- Delete public/models/kaykit, glbModels.ts, modelsOptIn.ts and the ?models=kaykit path. Keep a DEV-only ?troops=rigs A/B switch.
- CREDITS.txt with the source URL, version, licence and SHA-256.

11. CARD PORTRAITS (cardportraits.ts)
- Every humanoid portrait is rendered from its variant (knee-up, 3/4 front, per edition) and redrawn when the cast arrives.
- Fix the pale knight portrait.
- Non-humanoid portraits keep rendering from characters3d.
- Update gallery.ts to show the cast.

12. TESTS
- per-variant bake budget: 1 draw, vertex cap, 23 bones;
- palette rule test: forbidden signature hues, team paint on cloth;
- coverage test: every humanoid card id plus the crews, in both editions, has a variant or is on an explicit fallback list;
- lean math test for both viewpoints;
- dispose test: skeleton and bone texture freed;
- update troops, animate and portraits tests.

13. NOTES
notes/features/art-cast-kit.md: the variant table, perf numbers at start and end, and screenshot paths.

PRIORITY ORDER
1. Starter-deck units: knight, archers, giant, wizard, musketeer, mini-pekka, skeletons, valkyrie, witch, and the crews.
2. The rest of Classic.
3. Golden Age.
4. Champion options.
Both editions must be complete before acceptance.

#### Acceptance

1. Quality gates:
- npx tsc --noEmit is clean;
- npx vitest run passes in full, with golden.test.ts and bot.test.ts unchanged and passing;
- npm run build succeeds;
- node tools/perf-budget.mjs --url <own port> for Classic and for --edition arabic (390x844@2, high): fight at most 330 calls on this branch (the C base is 431), empty at most 200, numbers recorded in the notes.

2. Contact sheets, read by eye:
- /tmp/claude-0/art/cast-kit/sheet-classic.png and sheet-golden.png: every humanoid card plus the crews, both teams, front and back, through the battle camera with lean, plus a 40 px strip;
- the verifier must be able to name each unit from behind;
- the side reads from the body;
- no signature red or blue;
- the giant and valkyrie differ;
- the archers show bows;
- the king reads as a face plus crown.

3. Standard screenshot matrix (sharedRules):
- 4 arenas x 2 editions x (390x844@2 and 1440x900), quality=high;
- plus a quality=low phone shot per edition;
- plus ?viewpoint=enemy on the phone;
- plus 4 extra Golden Age units (janissary, duelist, alchemist, militia) spawned in courtyard.
The verifier checks:
- your own troops show back identity, not hat discs;
- no name tags;
- HP bars are outlined and team-tinted;
- hit flashes never go white;
- the 3-frame walk strip shows no foot sliding.

4. Colour-blind palette: switching it mid-battle repaints live units (before and after shots).

5. Downloads and loading:
- du -sh public/models/troops is at most 1.0 MB;
- public/models/kaykit is gone;
- no console errors;
- the cast loads before the first battle in a fresh profile (log the timing).


### creatures-fx (wave 1): Creatures, buildings and every effect in the cast's material language (both editions)

**Start from:** Shared wave-1 base: proto/handcrafted-plus at 52a1c29.
1. git -C /home/user/clash-royale-clone worktree add /home/user/wt-art-creatures-fx -b art/creatures-fx 52a1c29
2. Symlink node_modules from the main checkout.
C's cel-ramp and ground-occlusion edits to characters3d.ts are the starting point.

**Owns:** `src/render3d/characters3d.ts`, `src/render3d/characters3d.test.ts`, `src/render3d/champion3d.test.ts`, `src/render3d/cardwaveRigs.test.ts`, `src/render3d/rigBake.ts`, `src/render3d/rigBake.test.ts`, `src/render3d/rigBudget.test.ts`, `src/render3d/weld.ts`, `src/render3d/weld.test.ts`, `src/render3d/scene/fx/**`, `src/render3d/projectiles.ts`, `src/render3d/projectiles.test.ts`, `src/render3d/impactfx.ts`, `src/render3d/impactfx.test.ts`, `src/render3d/spawnfx.ts`, `src/render3d/spawnfx.test.ts`, `src/render3d/deathfx.ts`, `src/render3d/deathfx.test.ts`, `src/render3d/particles.ts`, `src/render3d/particles.test.ts`, `src/render3d/popups.ts`, `src/render3d/popups.test.ts`, `src/render3d/hitstop.ts`, `src/render3d/hitstop.test.ts`, `src/render3d/shake.ts`, `src/render3d/shake.test.ts`, `notes/features/art-creatures-fx.md`

#### Spec

GOAL
Everything procedural that moves or explodes on the field looks like it belongs with the KayKit cast:
- non-humanoid troops;
- card buildings;
- projectiles, spells, impacts, deploy bursts and deaths;
- damage numbers.

1. CREATURE RESTYLE (characters3d.ts)
- Apply the art bible's material language: 3-band ramp at 0.62, 0.86 and 1.0, cool rim, albedo saturation 1.12, ground occlusion, ink at 1.6 px on a smoothed-normal hull with no fins. Hit flash stays in animate.ts, owned by cast-kit.
- Big readable shapes, at least 2 silhouette features per unit.
- Team colour on ONE cloth or trim slot only.
- Classic:
  - baby-dragon: green, team scarf, never blooms;
  - balloon: team stripe on the envelope, kit-style pilot;
  - bats: violet;
  - minions: purple-grey with a team bandana, NOT signature blue;
  - gargoyles: stone with a team collar;
  - stone-golem and pebble-golem: rune glow below the bloom threshold;
  - skeleton-barrel;
  - comet rock;
  - buildings: cannon (bronze, team pennant), tombstone (team wreath), elixir-collector (team trim).
- Golden Age (ISLAMIC_BUILDERS): war-elephant (team saddle cloth), fire-kite, roc-hatchling, war-falcon, sandstone-golem, sand-pebble.
- Flyers keep their hover heights; their blob shadows and silhouettes must read against both grass and courtyard paving.
- The hand-built humanoid rigs stay as the procedural FALLBACK. They only take the shared ramp, ink and flash constants; no redesign.
- Keep every export other files import (buildTroop, toon, paintedToon, animateTroop, buildTower* crews, buildCometRock, buildChampionRig, TroopRig, archetype helpers) signature-compatible.
- Hog, horse and camel mounts for the kit riders are built by cast-kit. Leave the procedural versions as fallback.

2. RIG BUDGETS
rigBake MESH_BUDGET and SWARM_BUDGET stay the same or go lower. Update rigBudget.test.ts if parts merge.

3. FX RESTYLE (scene/fx/**, projectiles.ts, impactfx.ts, spawnfx.ts, deathfx.ts, particles.ts)
- Toon flames in 3 tones.
- Puffs are outlined and tinted (dust takes LOOK.floor colours, smoke takes the effect colour); NEVER opaque white. They are smaller: at most 1.2 tiles for single-target hits.
- Hit sparks: 4-6 star sprites.
- Projectiles are modelled:
  - fireball and wizard fireball: an emissive core above the bloom threshold, 3 flame petals and a smoke ribbon. NOT a cone; C's 'ice-cream cone' must be gone.
  - arrows with fletching;
  - a musket tracer;
  - ice, electro and magic-archer bolts.
- Spell areas (arrows, zap, freeze, rage, heal, tornado, mirror, comet, fireball, etc.): a team-colour ring with a white inner rim at the true radius.
- Deploy burst in the team colour.
- Deaths are tinted, and golem crumble chunks use the ramp.
- Golden Age keeps the same shapes with gold and turquoise accents where it has them today.

4. DAMAGE NUMBERS (popups.ts)
- Lilita One, gold fill #FFD23F, a 3 px #1D1630 stroke and a soft drop shadow.
- Crits and tower hits are about 1.3x.
- Hits on the same target within 150 ms merge, and stacks offset vertically so numbers never overlap.
- They must be legible on lime grass, snow and lava.
- Golden Age digits stay as they are today.

5. BLOOM CONTRACT
Design every FX colour for threshold 0.9 and strength at most 0.35 (stage owns post.ts). Only cores and sparks exceed luminance 1.0. Screen flashes call setFlash at 0.25 or less.

6. FEEL
hitstop.ts and shake.ts are retuned for the new density. Visual only; no sim change. Particle counts obey particleScale().

7. TESTS
- fx tests updated;
- popups merge and stack test;
- a projectile test asserting the fireball has no cone primitive and has a core above the threshold;
- puff opacity and size cap test;
- rig budget test;
- a team-slot test for each creature.

8. NOTES
notes/features/art-creatures-fx.md, with before and after shots.

#### Acceptance

1. Quality gates:
- tsc clean;
- the full vitest suite passes, with golden and bot tests unchanged;
- build succeeds;
- perf-budget for both editions: fight calls no more than the base +10 and triangles no more than the base +5%. Record the base at the start.

2. Creature sheet /tmp/claude-0/art/creatures-fx/creatures.png: every creature and building, both teams, front and back, both editions, plus a 40 px strip. The verifier names each unit and its side.

3. FX sheet /tmp/claude-0/art/creatures-fx/fx.png: each projectile and spell caught mid-flight or at impact. Use ?quality=high and crop at 3x. The verifier checks:
- the fireball reads as a fireball;
- no opaque white puffs;
- the rings show the team colour.

4. Mid-fight phone shots (390x844@2, high) in training-camp and pekka-playhouse, both editions, with the bot fed elixir:
- damage numbers are legible on grass and lava;
- nothing blows out to white;
- the baby dragon or roc does not bloom.

5. The standard screenshot matrix (4 arenas x 2 editions x phone and desk), plus a quality=low phone shot per edition. No console errors.


### towers (wave 1): Castle towers: team-roofed keeps for both editions and all 22 looks, crew slots, HP plates, damage stages, collapse and ruins

**Start from:** Shared wave-1 base: proto/handcrafted-plus at 52a1c29.
1. git -C /home/user/clash-royale-clone worktree add /home/user/wt-art-towers -b art/towers 52a1c29
2. Symlink node_modules.
C's towerCraft.ts and towers.ts are the starting point. Read A's silhouetteOutlineMaterial (git show e4be8f7:src/render3d/outlineMaterial.ts) for the depth-pushed silhouette ink idea; implement it inside towerCraft.ts, because outlineMaterial.ts belongs to cast-kit.

**Owns:** `src/render3d/scene/views/towers.ts`, `src/render3d/scene/views/towers.test.ts`, `src/render3d/scene/views/towerCraft.ts`, `src/render3d/scene/views/towerStyles.ts`, `src/render3d/scene/views/towerStyles.test.ts`, `src/render3d/towerCollapse.ts`, `src/render3d/towerCollapse.test.ts`, `notes/features/art-towers.md`

#### Spec

GOAL
C's hand-sculpted castles become THE towers in both editions and all 22 looks, with team colour that reads at a thumbnail, crew that sits inside the walls, HP plates that never collide, and real damage, collapse and ruin states.

1. CLASSIC MASSING (art bible section 2)
- Model all 4 faces with depth; the guest sees the back. This fixes the 'front-elevation wall plus top-down roof cardboard' critique.
- Battered base, quoins, slits, an arched gate on the camera face, corbelled parapet and merlons.
- Bartizan turrets with smooth team cones: at least 16 segments, smoothed normals and a painted tile texture, so no faceted pie slices.
- Gold finials, team trim bands, a team banner, and plinth and paving.
- King: a wider keep, 4 turrets plus a team canopy over the dais, crest and cannon.

2. GOLDEN AGE
- The same massing in sandstone or marble ashlar.
- Bulbous team domes (at least 12 segments, smoothed) and a larger king dome canopy.
- Horseshoe-arch gate, stepped Moorish merlons, a zellige band (THEME turquoise and gold) and gilded finials.
- Reuse onionDome and crescentFinial from arena/build.ts, read-only; stage keeps them stable.
- Replace the old flat Golden Age towers completely.

3. PER LOOK (new scene/views/towerStyles.ts)
- Stone from look.tower.enemy and look.tower.player (BrickVariant).
- Plinth, battlement and platform colours from the look.
- Look-id extras:
  - snow caps: snow, ice, atlas;
  - ember cracks below the bloom threshold: forge, copper;
  - vines: jungle, ghouta;
  - neon edge strips: neon;
  - bone lintels: bone.
- Roofs and domes are ALWAYS the live team colour from teamPalette(), including the colour-blind palette, and repaint on prefs change.
- Flair tiers 0, 1 and 2 (setTowerFlair): gilded trim and finials; then a jeweled crest and gold roof bands.

4. INK
Silhouette-only ink on the keep and roofs: a depth-pushed hull with smoothed normals, 1.6 px, #1F1A2E. No fins, and no ink on bricks.

5. CREW SEAM
- Add and export setTowerCrewProvider(p) in towers.ts, implementing the crew contract in sharedRules.
- With no provider registered, the existing hand-built crew shows (buildTowerPrincess, buildTowerCannoneer, buildTowerDuchess and buildTowerKing from characters3d, read-only).
- Crew slot: the crew stands inside the crenellations with the head and weapon above the parapet, at about 0.75 of a field archer's height.
- The king slot is under the canopy, facing the camera side, readable from both viewpoints.
- Size the slot for a 2.0-2.3 unit tall crew, scaled by the provider.

6. HP PLATES
- Enemy: above the tallest roof tip. Player: under the gate foot.
- Never over the crew or roofs, with at least 4 px clearance at 390 px wide. Clamp in screen space for squat and landscape screens.
- Check from ?viewpoint=enemy too.

7. DAMAGE
- Stage 1 (HP below 70%): crack decals on 2 faces, 1 merlon chip.
- Stage 2 (below 40%): 2 more merlons gone, a patch of missing roof tiles, a torn banner, one smoke wisp sprite.
- Destroyed:
  - towerCollapse.ts splits the tower into 3-4 chunks (roofs, turrets, upper keep) that topple with dust;
  - it leaves a RUIN: a jagged broken stump, a rubble mound, a scorched ground ring and the fallen banner (C's crater is the starting point);
  - no grey disc, and no mud-darkening.
- King wake: the cannon rises and the king stands.
- The KO zoom and victory flow are unchanged.
- Tower hit flash at most 0.25. The values live in animate.ts (cast-kit); request any change through notes.

8. SHADOWS
The towers and crew slots cast real shadows on the static shadow map. Call markShadowsDirty on damage stages and collapse.

9. BUDGET
- At most 5 draws per tower excluding the crew; all 6 towers at most 60k triangles at L0.
- At L4: no ink, and the same silhouettes.

10. API
Keep the towerCraft.ts exports Sculpt, tone, frustum, sculptMaterial and ashlarTexture signature-compatible; stage's scenery.ts imports them.

11. TESTS
- towerStyles covers all 22 look ids in both editions;
- the damage stage thresholds;
- collapse chunk count;
- the crew provider seam (fallback plus registered);
- the HP plate clearance maths;
- update towers.test.ts and towerCollapse.test.ts.

12. NOTES
notes/features/art-towers.md.

#### Acceptance

1. Quality gates:
- tsc clean;
- the full vitest suite passes, with golden and bot tests unchanged;
- build succeeds;
- perf-budget for both editions: empty calls no more than the base +6, and towers at most 60k triangles in total. The Golden Age empty count must be at most 200.

2. Close-up sheet /tmp/claude-0/art/towers/closeups.png: princess and king towers, both teams, both editions, in meadow, snow, forge, neon, courtyard, souk, copper and medina, plus flair 0, 1 and 2.
The verifier checks:
- the side reads at a thumbnail;
- no ink fins;
- smooth roofs;
- they look solid from both viewpoints (?viewpoint=enemy shot).

3. Damage sheet /tmp/claude-0/art/towers/damage.png, both editions: 100%, 60%, 30%, collapsing (2 frames) and ruin. Use __cr.battle() to set tower HP; the sim is untouched.

4. The standard screenshot matrix (4 arenas x 2 editions x 390x844@2 and 1440x900), plus a quality=low phone shot per edition:
- HP plates are clear of crews and roofs at 390 px;
- the crew sits inside the parapet;
- the king is not a sunflower.

5. No console errors, including the king KO and Victory flow.


### stage (wave 1): Stage: ground, river and bridges, surround and crowd, outer ring, lighting, shadows, grade, bloom and the quality ladder for all 22 looks

**Start from:** Shared wave-1 base: proto/handcrafted-plus at 52a1c29.
1. git -C /home/user/clash-royale-clone worktree add /home/user/wt-art-stage -b art/stage 52a1c29
2. Symlink node_modules.
C's scenery.ts, groundPaint.ts, river.ts, sky.ts and post.ts are the starting point.
Optional, outer ring only:
   git checkout proto/kit-world -- tools/kit-pack.mjs tools/kitview.html
Then adapt the region-culling and palette re-grade ideas from A's src/render3d/kitWorld.ts and scene/arena/kitSet.ts (read them with git show e4be8f7:<path>) into your own files. Do not take A's towers, castle, tilt-shift or fog push wholesale.

**Owns:** `src/render3d/scene/arena/**`, `src/render3d/scene/sky.ts`, `src/render3d/scene/post.ts`, `src/render3d/scene/post.test.ts`, `src/render3d/scene/camera.ts (applyFogRange and fog helpers ONLY; framing/fit code belongs to compact-hand)`, `src/render3d/quality.ts`, `src/render3d/quality.test.ts`, `src/render3d/arenaLooks.ts`, `src/render3d/arenaLooks.test.ts`, `src/render3d/ground.ts`, `src/render3d/ground.test.ts`, `src/render3d/fogfit.ts`, `src/render3d/fogfit.test.ts`, `src/render3d/staticBatch.ts`, `src/render3d/staticBatch.test.ts`, `src/render3d/kitWorld.ts (new, optional)`, `public/models/kit/** (new, optional)`, `tools/kit-pack.mjs (optional)`, `tools/kitview.html (optional)`, `notes/features/art-stage.md`

#### Spec

GOAL
The court every unit stands on becomes calm, crafted and festive in all 22 looks, with crisp light and no haze. Phones gain the most where the eye lands; wide screens get a world.

1. GROUND (groundPaint.ts, ground.ts)
- Kill the checkerboard: 2-tile mow stripes at plus or minus 3% lightness, an 8-tile value noise at plus or minus 4%, sparse clover and flowers away from the lanes, instanced tufts (top three levels), and painted occlusion at the kerb foot and around plinths.
- Pebble-edged dirt paths with darker worn edges and faint ruts, and flagstone aprons under the tower plinths (positions from game/arena constants; towers draws its own plinth).
- Implement all per-look recipes from art bible section 3 for the 11 Classic looks, plus the Golden Age courtyard recipe:
  - flagstones with zellige borders;
  - emblems at no more than 25% of today's contrast, and smaller;
  - ochre sand lanes with pebble edging;
  for all 11 Golden Age looks via ISLAMIC_LOOKS.islamic.

2. RIVER AND BRIDGES (river.ts, build.ts)
- A recessed channel with banks per band kind:
  - water: sand, reeds and lily pads;
  - lava: basalt lips;
  - ice: snow banks;
  - chasm: cliff lips;
  - neon: chrome.
- Bridges for every BridgeStyle: timber (C), stone arch, ice slab, gatehouse. Golden Age canals get a tiled lip.

3. SURROUND (scenery.ts, build.ts, kits.ts, backdrop.ts)
Inner ring:
- a dressed stone kerb with team post caps;
- a far-band tournament gate, crowd terrace and pennants, designed for the band compact-hand opens above the enemy king on phones;
- the near-band terrace.
Long sides:
- team bleachers with a NEW instanced chibi crowd: head, body and arms; 6 skin tones; 8 shirts biased to the team colour; bob plus wave or jump on tower hits and crowns (arenaOnEvent); 2 draws; static from L3 down;
- striped team pavilions and pennants.
Golden Age:
- arcaded horseshoe galleries hold the crowd;
- team-striped souk awnings;
- palms, domed flat-roof houses and lanterns.
Outer ring (wide screens only, region-culled on phones):
- Classic green looks: a village edge (cottages, windmill, stalls, orchard, forest). Build it from pruned KayKit Medieval Hexagon props (meshopt, at most 300 KB, loaded with the cast, no pop-in) OR procedurally; pick by eye.
- Themed variants for snow and ice, bone, forge, mystic and neon.
- Golden Age: rooftops, domes and palms.
C's blob forest is the fallback and the L3+ version. Re-material the existing backdrops into the shared ramp.
Instance the forest, rocks and crowd: the empty battle must be at most 230k triangles on this branch (C is 266k).

4. LIGHT AND SHADOW (sky.ts, post.ts)
- The art bible sun, hemisphere, rim and fill. Night-native looks keep their light pools.
- Shadow policy per art bible section 5.
- troopShadowLevel() must follow the LIVE quality level (fix the frozen-shadow bug) and allow ONE caster per unit. Keep its export stable; cast-kit and creatures-fx call it.
- Golden Age gets dynamic troop shadows too: trim its static casters so its fight stays within budget. Remove C's Classic-only !ARABIC gate.

5. GRADE AND BLOOM (post.ts, arenaLooks.ts grade)
- Saturation about 1.12, contrast 1.06, split tone, vignette at most 0.24.
- No tilt-shift. No haze over the court: in camera.ts edit ONLY applyFogRange so fog starts beyond the far band; leave the framing code alone (compact-hand's).
- Bloom threshold at least 0.9, strength at most 0.35, radius about 0.3.
- Cap setFlash at 0.25.
- Diagnose and remove the milky midfield wash seen in B's mid-fight shot, and say what caused it in the notes.
- The edge shade gets lighter where the sides are dressed.

6. QUALITY LADDER (quality.ts)
- Add fields to QualityLevel: troopShadows, dressing ('full', 'inner' or 'min'), crowdAnim, tufts and mixerHz (20, 30 or 60).
- Map them per art bible section 11 onto the existing L0-L4 without changing the governor's walking logic.
- L4 must look finished.
- Update quality.test.ts.

7. LOOKS (arenaLooks.ts)
- Add the palette fields the new set needs (kerb, crowd, pavilion and awning stripes, bank colours) for all 22 looks.
- Keep every existing field and the existing exports (lookForArena, LOOKS, ISLAMIC_LOOKS, ARABIC_LOOK).

8. API STABILITY
- Keep the build.ts exports other files import stable: onionDome, crescentFinial, makeLantern, archGateway, makeCrescentEmblem, buildArena, finishArena, updateRiver, updateCrowd, applyEndStrings and arenaOnEvent.
- Keep the post.ts exports stable: markShadowsDirty, troopShadowLevel, setFlash, applyQuality and the rest.

9. TESTS
- arena.test.ts: all 22 looks build with no missing pieces in both editions;
- the ground painter has no checker pattern (sampled pixel variance across tiles is under a threshold);
- the quality ladder fields;
- the post bloom contract constants;
- fogfit: fog never reaches the far band.

10. NOTES
notes/features/art-stage.md.

PRIORITY ORDER
The phone-visible parts first: ground, river, bridges, inner ring and far band, light and grade. Then the Golden Age court, then the remaining looks, then the outer ring.

#### Acceptance

1. Quality gates:
- tsc clean;
- the full vitest suite passes, with golden and bot tests unchanged;
- build succeeds;
- perf-budget at 390x844@2 and 1440x900, both editions: empty at most 185 calls and at most 230k triangles; fight at most 450 calls, including Golden Age with dynamic troop shadows.

2. The standard screenshot matrix (4 arenas x 2 editions x 390x844@2 and 1440x900, high):
- no checkerboard;
- the paths are pebble-edged;
- the river banks and bridge style fit each look;
- the far band above the enemy king is art-directed on the phone;
- the crowd is people, not pawns;
- no haze, and the enemy king is crisp.

3. Contact sheet /tmp/claude-0/art/stage/looks-22.png: all 22 looks at 1440x900, quality=medium, empty battle. No missing or placeholder pieces.

4. Ladder sheet: L0, L2 and L4 on the phone, Classic and Golden Age. L4 must still look finished.

5. Mid-fight phone shot: no milky wash.

6. A governor step-down test (pin quality, then change it): no frozen troop shadows.

7. Outer ring: if kit props are used, du public/models/kit is at most 300 KB and nothing pops in (shots at 0.5 s and 3 s after battle start).

8. No console errors.


### ship (wave 2): Integrate, wire, budget and sign off: merge the four art branches onto the live branch with compact-hand, finish the seams, gates, licences and the owner's before/after

**Start from:** The live branch claude/game-visuals-character-balance-w122wb, AFTER wip/compact-hand has been merged into it by its own owner (check with git log). Work in /home/user/clash-royale-clone or a worktree /home/user/wt-art-ship on branch art/ship.
Merge, in this order and with --no-ff:
1. art/stage
2. art/towers
3. art/creatures-fx
4. art/cast-kit
All four share base 52a1c29 and own disjoint files, so conflicts should be limited to files compact-hand also touched (camera.ts: the fog vs framing hunks).

**Owns:** `src/render3d/scene3d.ts`, `src/render3d/look/material.ts (new)`, `src/render3d/contextLoss.test.ts`, `src/main.ts (battle-start cast gate only)`, `tools/perf-budget.mjs`, `tools/shot.cjs`, `tools/visual-sheet.mjs`, `tools/record-battle.cjs`, `public/sw.js`, `package.json (scripts only)`, `THIRD_PARTY_NOTICES.md`, `README.md (assets section)`, `docs/deploy-multiplayer.md`, `notes/features/art-direction-2026-11.md`, `integration fix-ups in any wave-1 file after merge (tuning and wiring only)`

#### Spec

GOAL
One coherent, budget-clean, fully tested game in both editions, judged honestly by eye against the baseline.

1. MERGE
Merge in the order above. Resolve conflicts keeping the compact-hand framing and the stage's fog. Run the full gates after each merge.

2. WIRE THE SEAMS (scene3d.ts and, only where unavoidable, main.ts)
- setTowerCrewProvider(towerCrewProvider);
- the battle-start gate on castReady() with a 3 s timeout, falling back to the procedural roster for the WHOLE battle;
- the crowd events;
- read the new QualityLevel fields (mixerHz, troopShadows, dressing) where wave 1 used stopgaps;
- move the duplicated material constants (ramp, rim, ink, flash) into one exported module, src/render3d/look/material.ts, and point all packages at it;
- delete dead prototype code paths: the kit-world toggles and Classic-only gates.

3. INTEGRATION TUNING (fix-up rights)
You may edit ANY wave-1 file, but only for integration fixes and tuning numbers, with no new features:
- crew scale in the tower slots;
- HP plate clearance with real crews;
- team disc size;
- lean angle;
- grade and bloom against the final FX;
- giant footprint on the bridge;
- Golden Age overlays next to the Golden Age towers.

4. BUDGETS (tools/perf-budget.mjs)
- Add --max-triangles (default 850k fight, 300k empty) and --max-textures (110).
- Add a --matrix mode that runs both editions at 390x844@2 and 1440x900 and prints one table.
- Gates: 450 and 220 calls, plus the triangle and texture gates.
- Targets (record them): 400 and 200 calls, 750k and 260k triangles.
- Add `npm run perf:budget`.
- Optionally add a Vitest-free CI step only if Chromium is available in CI; otherwise document the manual gate.

5. OFFLINE AND SIZE
- public/sw.js precaches the cast (and kit props) per BUILD_ID.
- Record the dist size before and after; the initial JS bundle grows by at most 50 KB gzipped.
- Update the size line in docs/deploy-multiplayer.md.

6. LICENCES
- THIRD_PARTY_NOTICES.md at the repo root, listing every CC0 pack (URL, version, SHA-256) and the fonts.
- An assets section in README.md.
- Verify that every public/models folder has its CREDITS.txt.

7. FULL VERIFICATION MATRIX (look at every image)
- All 22 looks, contact sheet at 1440x900, Classic and Golden Age.
- The standard matrix at 390x844@2 and 1440x900 for both editions.
- L0, L2 and L4 phone per edition.
- ?viewpoint=enemy.
- 360x640 and 768x1024 phone and tablet, plus 844x390 landscape.
- The home diorama, the tutorial battle, a tower destroyed, the king KO and Victory, and an online guest view if the relay can run locally.
- Colour-blind palette.
- Sunset and night (?sky=0.6 and ?sky=1).

8. OWNER SHEET
/tmp/claude-0/art/ship/before-after-phone.png and before-after-desk.png: the baseline (0a8c97d) and the final side by side, both editions.

9. NOTES
notes/features/art-direction-2026-11.md: the direction, what each package delivered, perf tables, known gaps (for example the real-device fps check on a mid-range Android and an iPad), and how to A/B (?troops=rigs, DEV only).

#### Acceptance

1. On the live branch with compact-hand merged:
- npx tsc --noEmit is clean;
- npx vitest run passes in full (golden.test.ts and bot.test.ts byte-identical to 0a8c97d and passing);
- npm run build succeeds;
- npm run perf:budget passes every gate for Classic and Golden Age at 390x844@2 and 1440x900, with the table in the notes.

2. git diff 0a8c97d -- src/game is empty.

3. The full verification matrix is saved under /tmp/claude-0/art/ship/ and each image has been looked at. A verifier comparing before and after at phone size must see, in both editions and in at least 4 looks per edition:
- the side of every tower and troop is readable at a glance;
- your own troops show identity from behind;
- no name tags, haze or white blobs;
- the floor is calm, not a checkerboard;
- the far band and sides are dressed;
- the cards no longer crowd the board (compact-hand).

4. Fresh-profile load: the cast is ready before the first battle on a throttled 'Fast 3G' run, or the battle cleanly uses the procedural roster with no mixing.

5. Downloads within budget; THIRD_PARTY_NOTICES.md present; no console errors in any capture.

6. Commits merged on claude/game-visuals-character-balance-w122wb. Do not push unless instructed.


## Shared rules

SHARED RULES FOR ALL ART PACKAGES

1. BRANCHES AND OWNERSHIP
- Wave 1 is four packages in parallel: cast-kit, creatures-fx, towers and stage. Each starts from the SAME commit, 52a1c29 (proto/handcrafted-plus), in its own worktree /home/user/wt-art-<id> on branch art/<id>. Starting from the same commit is what keeps the merge clean, so do not rebase onto anything else.
- Wave 2 is the ship package, which merges all four into claude/game-visuals-character-balance-w122wb.
- Ownership is exclusive. Edit only the files your package owns; read anything.
- If you need a change in someone else's file, do not make it. Write the exact request (file, snippet, reason) under "Requests for ship" in your notes file; ship applies it in wave 2.
- During wave 1, every export of a file you own that another file imports on the base must stay signature-compatible (add, never change or remove). Wave-1 code may import only what exists at 52a1c29 plus your own files.

2. FROZEN FOR EVERYONE (ship has narrow exceptions)
- src/game/** (the deterministic sim). golden.test.ts and bot.test.ts must not change and must pass.
- src/ui/**, src/render3d/hud.ts, hudModel.ts, scene/fit.ts and the framing code in scene/camera.ts. These belong to the compact-hand package (wip/compact-hand).
- The compact-hand work is merged separately into claude/game-visuals-character-balance-w122wb by its owner. No art package edits its files. Ship merges after it lands and checks the art against the new tray.
- src/main.ts (ship may add the battle-start cast gate only).

3. NO SIM BEHAVIOUR CHANGES
- Render code reads entity state and never writes it.
- No new randomness in src/game.
- Visual randomness uses render-side seeded hashes only.

4. CREW CONTRACT (towers and cast-kit)
- towers.ts exports `setTowerCrewProvider(p: TowerCrewProvider | null)` where:
  - `TowerCrewProvider = { make(kind: 'tower-princess'|'tower-king'|'cannoneer'|'duchess', side: Side, edition: 'classic'|'golden'): { group: THREE.Group; height: number } | null; animate(unit, s: { attacking: boolean; cooldown: number; hitSpeed: number; asleep: boolean; frozen: boolean }, dt: number): void; dispose(unit): void }`.
- cast-kit exports `towerCrewProvider` from src/render3d/cast/crew.ts.
- Ship wires the two together in scene3d.ts.
- Without a provider, the towers show the hand-built crew.

5. ART RULES (full detail in the art bible)
- Team colour only on roofs, trim, banners, troop cloth and discs.
- Signature colours never fall in the team hue families.
- One material language: ramp 0.62, 0.86, 1.0; cool rim 0.35; ink #1F1A2E at 1.6 px; hit flash at most 0.35 (towers 0.25).
- Bloom threshold at least 0.9 and strength at most 0.35. Only emissive cores exceed luminance 1.0.
- No haze or tilt-shift. No floating name tags. Nothing opaque white.
- Each wave-1 package implements these constants locally; ship unifies them.

6. BUDGETS
- tools/perf-budget.mjs at 390x844@2 ?quality=high, both editions (and 1440x900):

| Measure | Hard gate | Target |
|---|---|---|
| Empty battle, draw calls | 220 | 200 |
| 12-card fight, draw calls | 450 | 400 |
| Empty battle, triangles | 300k | 260k |
| 12-card fight, triangles | 850k | 750k |
| Textures in the fight | 110 | — |

- Record your numbers at your start and end in your notes. Per-package ceilings are in each package's acceptance.
- Downloads: troop pack at most 1.0 MB; outer-ring props at most 0.3 MB; initial JS at most +50 KB gzipped; delete public/models/kaykit.
- Quality ladder per art bible section 11; L4 must still look finished.

7. LICENCES
- Only CC0 KayKit packs (Adventurers 1.0, Skeletons 1.0, Medieval Hexagon 1.0) and procedural art.
- Every asset folder has a CREDITS.txt with the source URL, version, licence and SHA-256 of each source archive. Ship writes THIRD_PARTY_NOTICES.md at the repo root.
- No Supercell or Clash Royale assets, logos or likenesses.
- Downloaded packs go in their own new directory outside the repo and are read as data only.

8. QUALITY BAR FOR EVERY COMMIT YOU CALL DONE
- npx tsc --noEmit is clean.
- npx vitest run passes in full.
- npm run build succeeds.
- node tools/perf-budget.mjs --url http://127.0.0.1:<your port> passes for Classic and for --edition arabic.
- No console errors or warnings in your captures.
- Commit early and often with clear messages: the container can restart and uncommitted work is lost. Do not push unless told to.

9. STANDARD SCREENSHOT MATRIX
- Viewports: 390x844 at deviceScaleFactor 2 with ?quality=high, and 1440x900 at 1 with ?quality=high; plus 390x844 at 1 with ?quality=low.
- Editions (localStorage 'cr-clone-arena-theme'): 'normal' and 'arabic'. Also set 'cr-clone-tutored'='1' and 'cr-clone-newcards-seen'='1'.
- Arenas (&arena=):

| Arena | Classic look | Golden Age look |
|---|---|---|
| training-camp | meadow | courtyard |
| barbarian-bowl | snow | souk |
| pekka-playhouse | forge | copper |
| legendary-peak | neon | medina |

- Scene: start a bot battle (example script: /tmp/claude-0/proto/baseline/shot-example.cjs), then spawn via window.__cr.spawn:
  - player: knight 4,21; archers 13,23; giant 5,18; wizard 12,20
  - enemy: mini-pekka 4,11; musketeer 14,9; skeletons 9,12; baby-dragon 10,7
  - take the shot about 6 s later.
- Save to /tmp/claude-0/art/<id>/<edition>-<arena>-<viewport>.png.
- LOOK at every image with Read and compare it to /tmp/claude-0/proto/baseline/. Judging by eye is the acceptance.

10. ENVIRONMENT
- 4 shared CPUs, SwiftShader only.
- Iterate at deviceScaleFactor 1 with ?quality=low. Take beauty shots sparingly.
- One Vite dev server per worktree on a fixed port, started with npx vite --port <port> --strictPort and killed by PID:

| Package | Port |
|---|---|
| cast-kit | 3201 |
| creatures-fx | 3202 |
| towers | 3203 |
| stage | 3204 |
| ship | 3205 |

- Never use pkill -f. Leave other agents' servers (3101, 3911, 3912) alone.
- Chromium is /opt/pw-browsers/chromium via puppeteer-core in the main checkout's node_modules. Launch with headless 'new' and args --enable-unsafe-swiftshader, --no-sandbox, --mute-audio. Never run playwright install.
- Symlink node_modules from /home/user/clash-royale-clone into your worktree.

11. NOTES
- Each package writes notes/features/art-<id>.md with: decisions, perf numbers at start and end, screenshot paths, known gaps, and Requests for ship.
