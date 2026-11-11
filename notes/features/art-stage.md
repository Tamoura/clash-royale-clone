# Art package "stage" (Toy Tournament, wave 1)

Spec: notes/features/art-direction-2026-11.md, "### stage". Branch art/stage from art/base (b7ae4ce),
worktree /home/user/wt-art-stage, dev server port 3204.

## Perf

perf-budget, `?quality=high`, first arena (training-camp: meadow / courtyard).

| View | Edition | Start empty calls / tris | Start fight calls / tris | End empty calls / tris | End fight calls / tris |
|---|---|---|---|---|---|
| 390x844@2 | Classic | 178 / 266,074 | 435 / 769,710 | 174 / 202,954 | 433 / 706,610 |
| 390x844@2 | Golden Age | 167 / 137,566 | 402 / 509,438 (no troop shadows) | 170 / 191,668 | 436 / 702,184 (troop shadows on) |
| 1440x900@1 | Classic | 176 / 266,048 | 433 / 769,692 | 178 / 226,100 | 431 / 729,780 |
| 1440x900@1 | Golden Age | 167 / 137,566 | 399 / 509,382 (no troop shadows) | 174 / 200,350 | 440 / 710,846 (troop shadows on) |

Acceptance: empty <= 185 calls and <= 230k triangles, fight <= 450 calls: all four pass
(`node tools/perf-budget.mjs --url http://127.0.0.1:3204 [--edition arabic] [--view 1440x900@1]
--max-empty-calls 185`, exit 0). Textures 49 in the fight. The Golden Age triangle rise is the
per-frame troop-shadow pass it now has.

Golden Age now casts dynamic troop shadows at L0 too (C's `!ARABIC` gate is gone); its fight stays
under 450 because the lit toon props are tint-batched (one vertex-coloured mesh per shadow setting):
the per-frame shadow pass draws ~30 static casters instead of 50.

## Decisions

- **Ground (groundPaint.ts).** No checker anywhere. Classic floors are recipes per look
  (`FLOOR_RECIPES`): lawn (meadow), moss with puddles (swamp), sand with bones (bone), snow drifts with
  sparkle (snow), basalt plates with ember seams (forge), violet moss with crystal flecks (mystic),
  packed earth with plank inlays (workshop), pale lawn with gold-edged paths (royal, whose floor
  palette changed from cream to a pale green), ice sheet with cracks (ice), deep green with leaf
  litter (jungle), pale 2x2 tiles with neutral glow seams (neon; no team colour on the floor).
  Grass gets 2-tile mow stripes at +-3%; every floor an 8-tile value noise at +-4%. Lanes are packed
  dirt with a lighter crown, darker worn shoulders, faint ruts and a pebble kerb (gold edge on royal).
  Flagstone aprons (`APRON` = 0.62 tiles past the platform) sit under every tower. Banks are painted
  per band kind (sand, snow for winter water, basalt with a glowing seam, a rocky drop, chrome).
  Golden Age: flagstones in a running bond, zellige border bands round the court and the canal,
  ochre sand lanes with pebble edging, aprons; the 3D crescents are 62% size at 25% contrast.
- **Tufts** (tufts.ts): one instanced draw of grass fans on grassy floors, L0-L2.
- **Light (sky.ts `LIGHT_RIG`).** The sun stands at (-12.6, 15.2, 3.5): from the left at ~49
  degrees, intensity 1.7, warm, a little toward the camera. The fill is 0.5 from (2, 4, 14), low over
  the camera's shoulder, so it lights walls and fronts more than the floor. Rim 0.45. Shadows fall to
  the right, about 10 degrees up the screen. `SUN_DIRECTION` and `SHADOW_SLOPE` are exported for blob
  offsets. History: the builder first tried the bible's "lower right" (z -4.4), then compromised at
  z -1.2 with a 0.3 fill from (2, 8, 14). Review found that rig put every camera-facing tower wall and
  troop front in its own shadow (the sun behind the board): walls fell to 45-52% of their art/base
  brightness. The ramp (characters3d) gives a face the middle band once n.l > ~0.06, and the shadow
  test needs a margin, so z +3.5 (n.l 0.17 on a +z wall) is the smallest sun that lights the fronts
  cleanly. The bible's "shadows fall lower right" and "camera-facing walls lit" cannot both hold with
  one sun under this camera; the fronts won (pillar 4, loud actors). See "Light rig fix" below for the
  numbers.
- **Grade and bloom (post.ts).** `DEFAULT_GRADE` 1.12 / 1.06 / vignette 0.2, every look clamped by
  `GRADE_LIMITS` (vignette <= 0.24); the bible's split tone; `BLOOM` 0.92 / 0.32 / 0.3; `setFlash`
  capped at `MAX_FLASH` 0.25; the edge shade is lighter (0.24) because the sides are dressed now.
- **The milky midfield wash in B.** Measured on this base with bloom on/off diffs: lit albedo does
  not cross 0.9 here (toon diffuse divides by pi: a white surface under the full rig is ~0.8 linear),
  so the stage's bloom only catches emissive cores. B's wash came from its kit troop material: the
  "brighter palette" plus its own rim/emissive term and the hit flash pushed pale troops (skeletons,
  the witch, bones) over the 0.9 threshold, and the 0.38 bloom with radius 0.34 spread those halos
  over the midfield where they cluster; B's +8 fog push and 1.2/1.1 grade made it read milky. Fixed
  here by the contract (threshold 0.92, strength 0.32, radius 0.3, grade 1.12/1.06, no fog over the
  court); the cast must keep albedo + rim + flash under the threshold (request below).
- **Fog (fogfit.ts).** `FAR_BAND` = 7: the fitted box covers the far band, so the gate, terrace and
  pennants above the enemy king are crisp; only the silhouettes and beyond fade. `applyFogRange` is
  untouched (it calls fitFog).
- **Shadows.** `troopShadowLevel(level = currentQuality())` reads the live level by default and
  honours `level.troopShadows`; `registerTroopCaster(mesh)` flags one caster; post.ts re-syncs
  every `userData.troopCaster` mesh every frame (one boolean compare) and re-renders the map once
  when the answer changes, so a step-down never leaves frozen troop shadows. The forest, outer ring,
  town, river decor and crowd never cast.
- **Quality ladder (quality.ts).** New fields: troopShadows, dressing ('full' | 'inner' | 'min'),
  crowdAnim, tufts, mixerHz. L0 all on, 60 Hz; L1 no troop shadows; L2 DPR 1.5 (was 1.75), static
  crowd, 30 Hz; L3 'inner' (outer ring hidden), no tufts; L4 'min', 20 Hz. The governor is
  unchanged. `applyArenaQuality` (build.ts) applies tufts, the outer ring and the crowd animation.
- **Crowd (crowd.ts).** Two instanced draws: a torso with raised arms (one geometry, so everyone
  cheers with arms up; a second arm pose would cost a third draw), and a head with a baked hair cap.
  Six skin tones, eight shirts, `crowdTeamShare` (0.42) of each half in its team colour (live
  palette, colour-blind included). Idle bob (L0-L1), a sway-wave on tower hits (arenaOnEvent:
  attacks landing within 2.2 tiles of a tower), a jump on crowns (towers.ts sets b.cheer).
- **Inner ring.** Classic: C's kerb with team pier caps (live team colour), terraces with pennant
  strings, shrubs along the kerb (now in the casting ring mesh). Far band: castle kit gets striped
  team awnings, pennant poles and bunting; every other kit gets a two-tier crowd terrace with awning
  and bunting (`farTerrace`). Near band: a dressed-stone wall with capped piers and flower boxes.
- **Golden Age surround (golden.ts).** Arcaded sandstone galleries (stepped merlons, zellige band,
  horseshoe end arcade, team banner) hold two rows of crowd; team-striped souk awnings and stalls;
  the town edge is the outer ring, palms the always-on fallback. The old slab stands, corner tents,
  fence runs, lone trees and drifts are gone. Town (`townPalette`, `townLots`): walls in three tones
  of the look's court plaster warmed toward its lane sand (kasbah earth in the snowy Atlas), dimmed on
  the night sets (souk, medina, copper) where the windows glow instead; roof lips and a parapet round
  a sunken deck; some domes, some set-back upper storeys; painted arched doors (souk blue, teal,
  green, oxblood, wood) and pairs of arched windows on the south face; lots never overlap and keep off
  the canal; six street lanterns per side along the lane outside the galleries (their cores and the
  night windows are one glow mesh per side, culled with the town). The far ground continues the sand
  apron in every Golden Age look (`farGroundMaterial`): the home diorama no longer shows green lawn
  corners under the sand at 1440x900.
- **Bridges (bridges.ts).** Stone: flagstone deck, ashlar parapets, finialled piers, abutment steps.
  Ice (`ICE_BRIDGE`): a glacier-blue body and deck (clearly bluer and darker than the snow floor),
  blue-grey kerbs along the long edges with a thin frost line on the outer edge, six low posts with
  small snow caps (the dark post tops show round them), a frosted lip and icicles on the camera face.
  The first pale slab (0xcfe8f6 deck, white frost rim) sampled the same value as the snow floor. Gate (neon): two pylons and a high lintel
  at the far end (clear of troops on the deck), slate deck with the gold buckle. Timber: C's.
- **River (river.ts).** Lips per band kind; reeds and lily pads on green water looks; snow lumps,
  basalt or crystal stones on the others.
- **Outer ring.** Procedural, not KayKit props (picked by eye: it matches the sculpted set and costs
  no download; nothing pops in). Themes per look (`OUTER_THEMES`): village (cottages, windmill,
  orchard, market stalls) for the green looks, chalets for snow and ice, rock spires for bone,
  basalt and forge huts, crystal spires for mystic, lit city blocks for neon. Region-culled every
  frame against the frame's half-width (a long strip's bounding sphere never leaves the frustum),
  so a portrait phone draws none of it.
- **Looks (arenaLooks.ts).** `StagePalette` (kerb, awning stripe, bank colours, crowd team share)
  on all 22 looks via `stagePalette()`. Every existing field and export is kept.
- **API.** build.ts keeps onionDome, crescentFinial, makeLantern, archGateway, makeCrescentEmblem,
  buildArena, finishArena, updateRiver, updateCrowd, applyEndStrings, arenaOnEvent; post.ts keeps
  markShadowsDirty, troopShadowLevel (now with an optional argument), setFlash, applyQuality and the
  rest; new exports only.

## Light rig fix (review round)

Camera-facing wall brightness, Rec.601 luma of the mean colour in fixed boxes (king front
36x14+178+638, left princess 30x12+65+568, right princess 30x12+295+568), 390x844@1,
`?quality=high`, empty bot battle 5 s after the start, art/base served from a `git archive` copy.
Percentages are of art/base. "Before" is art/stage at 46e6a46 (sun z -1.2, fill 0.3 from (2, 8, 14));
medina's "before" is the old rig replayed at runtime (light.cjs), the others are the real build.

| Look (arena) | art/base king / L / R | before | after (sun z +3.5, fill 0.5 low) |
|---|---|---|---|
| meadow (training-camp) | 121 / 131 / 129 | 54 (45%) / 60 (46%) / 61 (47%) | 105 (87%) / 101 (77%) / 99 (77%) |
| souk (barbarian-bowl) | 162 / 177 / 171 | 74 (46%) / 91 (51%) / 89 (52%) | 143 (88%) / 152 (86%) / 146 (85%) |
| medina (legendary-peak) | 142 / 157 / 156 | 61 (43%) / 78 (50%) / 78 (50%) | 120 (84%) / 131 (83%) / 127 (81%) |

Target was 65% or more: all nine walls are at 77-88%. The floor did not move: meadow grass beside
the king samples (109,185,41) before and (111,186,42) after. Tried and dropped: z +1.5 (the right half
of the king wall still self-shadowed), z +5 (2-3% brighter walls, shadows tilt further up), a 0.6
fill (a white surface under the andalus rig reaches 0.926 linear luminance, over the 0.92 bloom
threshold). post.test.ts pins the rig (sun from the left at 45-55 degrees, 0.12 < sun.z < 0.3, low
camera-side fill, shadows within 15 degrees of level on screen) and the bloom bound now searches every
normal and all 22 looks through the real ramp and light colours (worst 0.899 < 0.92).
Shots: /tmp/claude-0/art/stage-fix/v1/cmp-rig.png (rows meadow, souk, medina; columns art/base,
old rig, final), v1/zoom-towers.png; tools /tmp/claude-0/art/stage-fix/light.cjs (set the sun and
fill at runtime and shoot), pct.sh (box luma against a base shot).

## Requests for ship

1. **src/render3d/scene/views/troops.ts (cast-kit's):** one shadow caster per unit. Replace the
   "top two meshes" loop with `registerTroopCaster(biggestMesh)` from `../post` (or slice(0, 1)), and
   read `troopShadowLevel()` with no argument so it follows the live level. Reason: art bible
   section 11, per-frame shadow pass budget (`TROOP_CASTERS_PER_UNIT` = 1).
2. **cast-kit mixers:** read `currentQuality().mixerHz` (60/30/20) and share swarm poses at L4.
3. **cast-kit blob shadows (L1-L3):** offset the contact blob by `SHADOW_SLOPE` (sky.ts) times the
   unit's height so it falls with the sun (to the right).
4. **cast-kit/creatures-fx materials:** keep albedo + rim + hit flash under `BLOOM.threshold` (0.92
   linear); that is what made B's midfield milky. The fireball impact puff currently reads as an
   opaque white disc in my shots (creatures-fx), against the bible's "never opaque white".
5. **towers:** the final rig (sun (-12.6, 15.2, 3.5), fill 0.5 from (2, 4, 14)) lights camera-facing
   walls in the toon middle band, no longer in their own shadow. The towers branch was tuned under
   art/base's sun (-9, 17, 11); after the merge, measure its walls under this rig the way the "Light rig
   fix" table does (same boxes, same scene) and expect about 80-90% of their art/base value. Only if a
   wall reads dull next to its roof, lift that wall's albedo; do not move the sun (sky.ts owns it and
   post.test.ts pins it). Flagstone aprons are painted to `TOWER_FOOTPRINT + APRON` (groundPaint.ts).

## Screenshots and checks

- Start: /tmp/claude-0/art/stage/start/; iterations: /tmp/claude-0/art/stage/it*.png.
- Matrix (fight, 6 s after the standard spawns): /tmp/claude-0/art/stage/<edition>-<arena>-390x844@2.png,
  -1440x900.png and <edition>-training-camp-390x844-low.png; montages matrix-normal-phone.png,
  matrix-normal-desk.png, matrix-arabic-phone.png, matrix-arabic-desk.png. By eye against the
  baseline: no checkerboard, pebble-edged paths, banks and bridges per look, a festive far band
  (awnings, crowd, pennants) above the enemy king on the phone, people not pawns, no haze.
- Contact sheet (1440x900, medium, empty battle): /tmp/claude-0/art/stage/looks-22.png (rows 1-2
  Classic, rows 3-4 Golden Age, arena order of the trophy road); every look complete.
- Ladder sheet: /tmp/claude-0/art/stage/ladder.png (L0, L2, L4; Classic then Golden Age). L4 keeps
  the painted floor, aprons and occlusion, the set and the crowd: it still looks finished.
- Mid-fight wash: /tmp/claude-0/art/stage/midfight-normal.png, and midfight-normal-bloomx10.png with
  the bloom strength forced to 3: lit grass, towers and troops never glow; only spell impacts do.
- Governor step-down (Settings High, troops spawned, then Medium; /tmp/claude-0/stage-tools/governor.cjs):
  Classic casters 6 on -> 0 on, shadow map re-rendered once, a troop spawned afterwards casts none;
  Golden Age the same. Unit test in post.test.ts too.
- Outer ring pop-in: /tmp/claude-0/art/stage/outer-popin.png (0.5 s and 3 s after battle start,
  identical). No kit props: public/models/kit does not exist.
- Console: no errors from the game. The only failed requests in dev captures are 403s for the
  @fontsource woff files, because this worktree's node_modules is a symlink outside Vite's allowed
  fs root (a worktree artefact; the production build bundles the fonts).

## Known gaps

- The crowd shares one body: everyone cheers with raised arms (a second arm pose is a third draw).
- Golden Age outer ring: one town layout for all eleven looks (palette, doors, palms or cypresses
  vary); houses are boxes with parapets, doors and windows, no courtyards or stairs. Snow-capped
  cypresses only in the Atlas.
- The one-caster-per-unit rule and the mixer rates need cast-kit's side (requests 1-3).
- Classic outer ring is procedural; KayKit hexagon props were not used.
- Sun direction: shadows fall right and slightly up, not the bible's lower right (see Decisions:
  the lower right puts every camera-facing wall in shade).

## Progress log

- Start: worktree created from art/base, perf measured (above), start shots taken.
- 57e98d8: Classic floors per look (no checker), LIGHT_RIG in sky.ts, bloom/grade/flash contract in
  post.ts, quality ladder fields, live troop shadows (both editions), fog past the far band. Tests updated.
- instanced chibi crowd (crowd.ts), far-band awnings/pennants (kits.ts castle), forest mesh that
  casts no shadow, tint batching of lit toon props (Golden Age shadow casters 50 -> ~30).
- b793013: bridges.ts (stone, ice, gatehouse), river reeds/lily pads/bank lips, near-band terrace wall.
- 15048bb: Golden Age courtyard floor (flagstones, zellige bands, ochre lanes), small faint crescents,
  golden.ts galleries + souk awnings + town edge.
- tufts, outer ring per theme, per-side strips + region culling (7349a45).
- 42cc97e: StagePalette on all 22 looks; set tests (no checker, all looks build).
- fbba6f7: far-band crowd terrace on every kit. Full vitest suite green at 42cc97e.
- c9ad5ef..194e933: canal tile coping, snow floor toned, cypresses for non-palm Golden Age looks,
  calmer forge seams. Contact sheet, matrix, ladder sheet, governor and wash checks done.
- Final quality bar at 194e933: tsc clean, vitest 136 files / 1609 tests pass, npm run build ok,
  perf-budget passes in all four configurations (table above). Package complete.
