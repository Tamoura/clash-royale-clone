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
- **Light (sky.ts `LIGHT_RIG`).** The sun stands at (-12.6, 15.2, -1.2): from the upper left at
  ~50 degrees, intensity 1.7, warm. Shadows fall to the right and slightly down. I tried the full
  "lower-right" (z -4.4) first: it put every camera-facing tower wall into the darkest toon band and
  the board read gloomy next to C, so the sun keeps a small negative z (front faces sit in the mid
  band). Rim 0.45, fill 0.3 from the camera side. `SUN_DIRECTION` and `SHADOW_SLOPE` are exported
  for blob offsets.
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
  the town edge (domed flat-roof houses) is the outer ring, palms the always-on fallback. The old
  slab stands, corner tents, fence runs, lone trees and drifts are gone.
- **Bridges (bridges.ts).** Stone: flagstone deck, ashlar parapets, finialled piers, abutment steps.
  Ice: thick pale slab, frosted rim, snow lumps, icicles. Gate (neon): two pylons and a high lintel
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
5. **towers:** the sun moved to the upper left (`LIGHT_RIG.sunPosition`), so the camera-facing walls
   sit in the toon mid band; if they read dull next to the roofs, brighten the wall albedo rather
   than moving the sun. Flagstone aprons are painted to `TOWER_FOOTPRINT + APRON` (groundPaint.ts).

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
- Golden Age outer ring is one town for all eleven looks (palette, palms or cypresses vary);
  domed houses are simple boxes. Snow-capped cypresses only in the Atlas.
- The one-caster-per-unit rule and the mixer rates need cast-kit's side (requests 1-3).
- Classic outer ring is procedural; KayKit hexagon props were not used.
- Sun direction is a compromise (see Decisions): shadows fall right and only slightly down.

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
