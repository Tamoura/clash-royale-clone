# Art ship (wave 2): final integration of "Toy Tournament"

Package `ship` from `notes/features/art-direction-2026-11.md` (## Packages, ### ship). Branch `art/ship`, worktree `/home/user/wt-art-ship`, created from `claude/game-visuals-character-balance-w122wb` at `29f6451`. The four wave-1 packages (stage, cast-kit, creatures-fx, towers) were already merged there by their per-package shippers, so this package does not merge: it wires what is left, unifies the material constants, tunes, budgets, verifies and writes the owner's before/after.

Dev server: port 3205 (verifiers 3215). Shots: `/tmp/claude-0/art/ship/`. Drivers: `/tmp/claude-0/art/ship/tools/`.

## Decisions

- **No merges here.** The four wave-1 packages were merged into the live branch by per-package shippers (stage, cast-kit, creatures-fx, towers, in that order). This package starts from their result (`29f6451`) and only wires, unifies, tunes, budgets and verifies.
- **Seams.** Crew provider (`castTowerCrews` in scene3d.ts, latched per battle), the battle-start cast gate (main.ts `afterCastGate`, 3 s, whole battle) and the crowd events (`arenaOnEvent`, `updateCrowd`) were already wired; I checked each in the matrix (6 cast crews in every capture with the pack in; fresh-profile tutorials that start before the pack run on the procedural roster for the whole battle). The one stopgap left was `troopShadowLevel` (`shadowSize >= 2048 && bloom >= 1`); it now reads `QualityLevel.troopShadows`. `mixerHz`, `dressing`, `crowdAnim` and `tufts` were already read.
- **One material module** (`src/render3d/look/material.ts`): toon ramp and band edges, the cool rim and ONE shared rim uniform (cast and rigs were two objects), ink colour / width / depth, ground occlusion, saturation, tint cap, the troop / tower / screen flash caps, plus the ramp, rim and roll-off GLSL. cast/bake.ts, characters3d.ts (`RIG_*`), outlineMaterial.ts, towerCraft.ts, scene/views/animate.ts, scene/post.ts and fx/pool.ts read it; `material.test.ts` pins them together. `OUTLINE_CSS_PX` is now the shared 1.6 (plain hulls were 1.25), so the cast's and rigs' width rescale is gone, and the shared ink colour is #1F1A2E (was #1C1730). Unbaked `toon()` parts keep the handcrafted coloured ramp (see Known gaps).
- **Bloom-safe characters.** A soft luminance roll-off (`litClamp`, knee 0.8, ceiling 0.9 linear with the bloom pass's weights, under `BLOOM.threshold` 0.92) ends the cast's and the rigs' lit fragment, after the rim and the hit-flash mix. It only touches pixels that would have bloomed. Measured on screen: the janissary's cream bork peaked at 0.94-0.96 luminance in the cast-kit review, now 0.80-0.815; the Golden Age tower-king turban was #FFFFFF on the contact sheet, now 0.861 in battle. It also covers white beards and the hit flash.
- **Plates.** `clampPlate` slides a plate toward its tower on the same side while it keeps the art bible's 4 px floor (the scene asks for 6 px), and only flips after that. The Golden Age far king's plate on a 390x844 phone was 0.5 px short and flipped under his gate (towers request 6); it now sits over his qubba in every phone capture.
- **Sun-offset blobs (stage request 3).** On every level without real troop shadows (L1-L4), a walker's contact blob slides `SUN_BLOB_SHARE` (0.32) of its height along `SHADOW_SLOPE` and stretches along it (0.35 per unit), so the blob reads the sun's direction (shadows fall right) and still covers the feet. On L0 the shadow map draws the real shadow and the blob stays centred. Follows the live level.
- **Golden valkyrie braids (cast-kit review).** `headCloth` takes a hem; hers ends at 1.56 so both orange braids hang clear below it from behind (checked in a back view).
- **Giant footprint.** The Golden Age Giant is a procedural war elephant; at the Classic Giant's 1.48 it was about 2.2 x 4.6 world units and covered a whole bridge while turning. Now 1.3 (head-top 3.36, still in the large band).
- **Ribbon taper (creatures-fx review rest).** Ribbon puffs shrink to about 0.6 of their birth size as they age (still overlapping at the half-size spacing), so the trail tapers to its tail.
- **Lazy cast roster.** The heavy half of the cast (variant tables, props, mounts, bake, units: `cast/roster.ts`) is a lazy chunk fetched with the pack; `cast/index.ts` is a light facade that answers "no cast" until it is in (`castRoster()` in loader.ts). This took the initial `index-*.js` from 339.2 to 324.0 KB gzipped, which puts the art round inside its +50 KB budget against the pre-art live build (see the size table in the art-direction ship log).
- **Kept as is (checked by eye):** crew scale in the slots (0.72 of field size), team disc size and the notch, the 14 degree lean, grade and bloom against the final FX (no haze, no white blobs; the only white glow in 66 captures is the bot's emote bubble), Golden Age floor overlays next to the Golden Age towers (faint crescents at 25% contrast, never under a plate). The hat-height exception (wizard 2.98, ice-wizard 2.95, executioner 3.05, janissary 3.04, duelist 2.91) is signed off: those hats read as identity from behind and their HP bars sit above them.
- **Colour-blind Golden Age enemy hue (creatures-fx request 8):** kept orange. The blue/orange pair is the standard deuteranopia-safe pair; on the Golden Age court the orange domes, discs and cloth stand clear of the sandstone and gold in the CB captures, and a magenta near 300 degrees would sit on the pink of the Golden archers' hair and the mystic look's violet.
- **Not changed (frozen file):** `?viewpoint=enemy` in bot battles (main.ts outside the gate), listed under Known gaps. The far king at landscape sizes was frozen here too (fit.ts / layout.ts framing, compact-hand); the freeze was lifted once the art packages were finished and the framing round below fixed it.

## Requests for ship

None (this is the ship package).

## Progress log

- Start: worktree from `29f6451`. Baseline build of `0a8c97d` in a throwaway worktree (`/home/user/wt-ship-baseline`): dist 12.9 MB (11.0 MB of it `public/models/kaykit`), `index-*.js` 283.9 KB gz, `three-*.js` 157.2 KB gz. Baseline shots for the owner sheet: `/tmp/claude-0/art/ship/baseline/` (training-camp phone and desk, both editions, plus barbarian-bowl, pekka-playhouse and legendary-peak on the phone, both editions).
- Dev-server note: `node_modules` is a symlink into the main checkout, so the dev server 403s the fonts outside the worktree. Shots use a git-ignored wrapper config (`visual-sheet/vite.fsallow.config.mjs`, adds `server.fs.allow`), so captures have the real fonts and no 403 console errors.
- Seams (commit 2442043): `src/render3d/look/material.ts` holds the material language and every package reads it; `troopShadowLevel` reads `QualityLevel.troopShadows`; dead prototype paths removed. Crew provider, battle-start gate and crowd events were already wired by the per-package shippers (checked, kept).
- Tuning (ca4d608, 94b00c7): plate slide within the 4 px floor (Golden far king on a phone), sun-offset blobs on L1-L4, luminance roll-off under the bloom threshold (bork 0.94-0.96 -> 0.815, king turban #FFFFFF -> 0.861 measured), valkyrie braids, Golden war elephant 1.48 -> 1.3, ribbon taper.
- Budgets and offline (d4178d2): perf-budget triangle/texture gates, `--matrix`, `npm run perf:budget`; sw.js precaches the cast per build.
- Size (4186f6c): the cast roster is a lazy chunk; initial `index-*.js` 339.2 -> 324.0 KB gz.
- Licences and docs (2d3bd8e, a756251): THIRD_PARTY_NOTICES.md, README assets section, deploy guide lines, assets test.
- perf:budget matrix on the dev server: every gate passes in both editions at both views (table in the art-direction ship log).
- Verification matrix done and looked at (66 dev captures: `matrix/`, `looks/`, `extra/`, contact sheets `looks-sheet-{classic,golden}.png`); no errors in any. Production on the relay (port 3206, stopped by PID): smokes, Fast 3G fresh and returning profiles, an online "Play a friend" match in both editions (`prod/`); no errors, no failed requests.
- Owner sheets: `/tmp/claude-0/art/ship/before-after-phone.png` and `before-after-desk.png` (built by `tools/sheets.sh`).
- Notes: the art-direction ship log section "5. ship" (eb3a16a).
- Final quality bar on `eb3a16a`: `npx tsc --noEmit` clean; `npx vitest run` 140 files / 1,732 tests pass (golden.test.ts and bot.test.ts identical to `0a8c97d`, `git diff 0a8c97d -- src/game` empty); `npm run build:all` succeeds; `npm run perf:budget` (its own dev server) passes every gate in both editions at both views (fight 180-206 calls, 628k-670k triangles, 75-76 textures; empty 100-114 calls, 251k-274k triangles).
- Cleanup: dev server on 3205 stopped by PID; the throwaway baseline worktree removed.
- Polish round start (`d9e4ead`): critics' issues deduplicated (table above). Renders come from a snapshot copy of the worktree (`/home/user/wt-art-ship-snap`, its own Vite on 3205 with HMR off and its own cache dir) so edits never reload a capture; drivers in `/tmp/claude-0/art/ship/polish/tools/`, shots in `/tmp/claude-0/art/ship/polish/it*/`.
- Polish commits: d838882 (floors, night grade, emote, diorama, ruin, roc, numbers), f4e30c0 (outer ring, contact shadows, flyer discs, bridges, aprons, far band), 5080d91 (floors to a 0.70 screen value, dark ashlar, HP numerals, crowd, tray gap, elephant), c0fcb9f (neon gatehouse deck).
- Polish by eye (all looked at; `/tmp/claude-0/art/ship/polish/it1..it5/`): the four showcase looks per edition at 390x844@1 high (it4), courtyard and medina and neon at 390x844@2 (it3, it5), the home diorama at 2x (it2), destroy runs in courtyard and forge (it2), the emote bubble (it4), 1440x900 Classic meadow and Golden Age courtyard and medina (it3, it4), 360x640 (it4), L4 phone (it3). Measured on screen at 390 px: meadow court 0.65 luma, snow 0.68, neon 0.64, courtyard 0.71, souk 0.45, medina 0.37 (night), forge 0.21; units and lanes read in every look; no page or console errors in any capture.
- Polish quality bar at c0fcb9f: `npx tsc --noEmit` clean; `npx vitest run` 140 files / 1,756 tests; `git diff 0a8c97d -- src/game` empty and no frozen file touched (src/ui, hud, hudModel, fit, camera framing, main.ts); `npm run build:all` succeeds (index 325.4 KB gz, +1.4 KB, so initial JS is +41.5 KB over `ed45f9c`, budget +50); `tools/perf-budget.mjs --matrix` passes every gate:

| View | Edition | Empty calls / tris | Fight calls / tris | Fight textures |
|---|---|---|---|---|
| 390x844@2 | Classic | 102 / 251,230 | 179 / 628,222 | 76 |
| 1440x900@1 | Classic | 106 / 276,298 | 183 / 653,294 | 76 |
| 390x844@2 | Golden Age | 110 / 256,952 | 201 / 659,360 | 75 |
| 1440x900@1 | Golden Age | 116 / 275,132 | 208 / 677,612 | 75 |

  (empty triangles at 1440x900 stay over the 260k target, under the 300k gate, as before.)
- Cleanup: the snapshot server on 3205 stopped by PID and `/home/user/wt-art-ship-snap` removed. Nothing pushed. Not pushed: the publish step belongs to the workflow's shipper (the computed task says not to push).
- Framing round (after the polish round, freeze on the framing files lifted): measured the kings on screen at ten screens in both editions (`/tmp/claude-0/art/framing/before/`), then 8d3e22c (fit the kings as built: the crown, pixel pads, `crownTop`, `plateFloor`, the two new tests), 038587f and 674601b (the plates' gap to the screen's edge: 10 px on a laptop, growing with the board). Verified and measured again (`after/`), tap and drag deploys checked, quality bar and perf matrix rerun; dev server on 3205 stopped by PID. Nothing pushed.

## Polish round (after the three critics' review of the final build)

Deduplicated issues (critics 1-3), and what this round does with each:

| Issue | Severity | Status |
|---|---|---|
| Near-white courts (snow, neon, every Golden Age court) sink white and cream units and erase the lanes | major | fixed: every court paints at most 0.65 luma (reads about 0.70 lit), lanes at least 0.06 apart; per-look Golden Age hues; `arena.test.ts` pins it for all 22 looks |
| Golden Age night courts lit like noon inside a dark town | major | fixed: night courts paint about 30% darker than day ones (tested) and the sun and hemisphere start toward moonlight (`NIGHT_NATIVE_LIGHT` in sky.ts); the existing lantern pools now read |
| Emote bubble: a white, bloomed disc over the enemy king's face | major | fixed: off-white #F2EBDD with the ink rim, hung beside the king (x +2.9), 0.7 size |
| Home diorama blurry on a 2x phone | major | fixed: `DIORAMA_DPR` 1.25 -> 2 (still half frame rate, no bloom) |
| Dark looks (forge, copper) crush the keeps to black boxes | major | improved: the dark ashlar, battlements and plinths are lifted and the hemisphere ground is a warm ember bounce; forge floor lifted to 0.32 paint |
| A fallen tower leaves a black, hard-edged pit; near-black collapse dust | major | fixed: soot on the paving in the paving's own tone, a soft floor-tinted scorch decal (alpha 0.55) instead of opaque rings and the dark crater; dust is the floor's dust lifted 20% |
| Golden Age troops are cream blobs on a cream court | major | improved through the floor (the courts are now mid sand, terracotta, ochre and lilac) and an emerald roc; headgear left cream (team colour on hats would break the team rule) |
| Wide-screen outer ring is placeholder art (Golden Age worst) | major | improved: Golden Age street, alleys and ground patches, painted contact shadows under every house, palm and stall (Classic cottages, stalls, windmill and trees too), door awnings and roof clutter, limewash in four tints; galleries without arcades remain (see Known gaps) |
| Laptop framing: far king cut at the top, his plate under his gate | major | fixed in the framing round (below): the frame fits the kings as built |
| Damage numbers oversized on phones, dark drop-shadow smudge | minor | fixed: 0.75 size under 500 px wide, lighter tighter shadow |
| Flyer ground marker reads as a splat | minor | fixed: the same disc at 0.6 opacity and 0.85 size |
| Grey tower aprons are heavy cold slabs | minor | fixed: 20% smaller and leaning 40% toward the lane dirt |
| Golden Age bridges are flat yellow slabs | minor | fixed: the gold "rim" covered the whole deck; now a laid sandstone deck with joints under a brass lip |
| Golden Age far band: a dome behind the clock; forge far band a black slab | minor | fixed: two smaller domes either side of the gate; the forge furnace lower and its wall lifted |
| HP plate numbers soft and haloed | minor | fixed: painted at 2x, cream #F4EAD6 with the shared ink |
| Crowd stands read as barcode noise | minor | improved: non-team shirts at 0.75 saturation in a narrow value band |
| War elephant reads as a boulder | minor | improved: warmer grey, big flared ears with pink insides, a tail tuft |
| Player king plate under the tray on 360x640 | minor | fixed in the framing round: near plates keep 10 px over the tray's top edge in tall mode (this round's 8 px gap only applied with a bottom inset, which tall mode never has) |
| Damage numbers from different targets overlap; tower fall payoff; lava "giraffe print"; archers' back cloth; cast ink at 85% alpha; Golden Age gallery arcades | minor | not done (Known gaps) |

## Framing round (the far king on laptops and landscape screens)

All three critics flagged it as major: on height-bound screens the far king, the most important building, was cut by the top edge, his HP plate flipped under his gate (where flyers cover it), and the near king's plate sat on the bottom edge. The card-tray and framing freeze was lifted for this fix (compact-hand files: `src/render3d/scene/fit.ts`, `src/ui/layout.ts`, `src/ui/layoutWire.ts`, the framing in `scene/camera.ts`).

**Measured first.** The old content box ran from the near fence (camera-up -12.8) to the far lanterns (14.0). Built with the cast king under his canopy, the far king reaches 15.107 (Golden Age qubba; Classic pavilion 14.90, 15.06 with gilded finials), and his plate goes 0.66 over that plus its gap. In the browser at 1440x900 his top was 30 px (Classic) / 37 px (Golden Age) above the screen (the keeps are the same height in every look; built in node across all 22 looks), and his plate had flipped under his gate on every wide screen, on the portrait tablet and on 360x640.

**The fix: fit the kings as built, not a margin.**

- `fit.ts` holds the kings' real extents: `FAR_KING_TOP` 15.12 (holds a king up to 2.07 tall; the cast king is 2.063), `KING_PLATE_H` 0.66, `NEAR_KING_FOOT` -11.75, and `CROWN_HALF_W` 2.3 (what rises past the lanterns: his roofs 1.67, his plate's level shield 2.06 to the left). The box is the board from the near king's plate to the far lanterns, plus a **crown**: the far king's column over its middle, up to his plate. Pixel pads that do not scale with the board (a plate's 6 px gap to its tower, 10 px over the tall tray's ornament) and an edge gap that does (`EDGE_GAP` 0.32 units: about 10 px on a laptop so the plates read as framed, 4 px on a landscape phone).
- `fitBattleFrustum` fits the board under the top inset and the crown under `Insets.crownTop`; `heightScale` gives the layout the same scale. In tall mode `layoutWire.ts` measures the chips over the king's column on their own, so on a portrait tablet (chips at the corners) he rises between them instead of shrinking the board; on phones the clock sits over his column and he goes under the band like the rest of the board.
- `towers.ts`: the far king's plate clamps against the chips over his column, near plates against the tray's ornament (`Framing.plateFloor`; the polish round's 8 px tray gap never applied in tall mode, where the bottom inset is 0).

**Board size, before and after** (CSS px per tile from `__cr.fieldRect()`, bot battle at Training Camp, DPR 1, measured by projecting each king's vertices and plate sprites to the screen; plate gaps are to the sprite bounds, the visible shield sits about 2 px further in):

| Screen | Layout | Tile before | Tile after | Board | Far king before | Far king after | Near plate gap before / after |
|---|---|---|---|---|---|---|---|
| 1440x900 | wide | 33.58 | 30.80 | -8.3% | cut 30 / 37 px, plate under his gate | whole, plate over his roofs | 6 / 8 px |
| 1366x768 | wide | 28.66 | 26.22 | -8.5% | cut 25 / 31 px, plate under his gate | whole, plate over his roofs | 4 / 7 px |
| 1920x1080 | wide | 40.30 | 37.04 | -8.1% | cut 36 / 44 px, plate under his gate | whole, plate over his roofs | 8 / 10 px |
| 1280x720 | wide | 26.87 | 24.56 | -8.6% | cut 24 / 29 px, plate under his gate | whole, plate over his roofs | 3 / 7 px |
| 1024x768 | wide | 28.66 | 26.22 | -8.5% | cut 25 / 31 px, plate under his gate | whole, plate over his roofs | 4 / 7 px |
| 844x390 | wide | 14.55 | 13.11 | -9.9% | cut 13 / 16 px, plate under his gate | whole, plate over his roofs | cut 1 / 4 px |
| 768x1024 | tall | 30.67 / 29.96 | 29.95 / 29.80 | -2.3% / -0.5% | whole (between the chips), plate under his gate | whole, plate over his roofs between the chips | 5 / 9 px |
| 390x844 | tall | 21.08 | 21.08 | 0 | whole, plate over his roofs | whole, plate over his roofs | 30 / 20 and 16 px |
| 360x640 | tall | 17.61 | 16.01 | -9.1% | cut 4 / 9 px under the chips, plate under his gate | whole, plate over his roofs | 0 (on the ornament) / 10 px |
| 412x915 | tall | 22.27 | 22.27 | 0 | whole, plate over his roofs | whole, plate over his roofs | 43 / 32 and 27 px |

(Two numbers: Classic / Golden Age where they differ.) The wide screens give up about 8.5% of the board: that is the far king's canopy (1.1 units over the old box) and his plate (0.66 and its gaps), nothing more; `framing.test.ts` checks that a height-bound board is tight on the kings (the near plate on its floor, the far plate on its gap). For comparison the critics' suggestion (6-8% top and 3% bottom margin) would have cost 9-11%. Width-bound phones (390x844, 412x915) keep their board: the compact tray's spare height takes the crown. The portrait tablet keeps nearly all of it because the king rises between the chips. Short phones (360x640) pay most: the scoreboard chips sit over his column, so the whole crown has to go under them.

**Verified by eye** (`/tmp/claude-0/art/framing/`, drivers in `tools/`: `fdrv.cjs` measures and shoots, `summ.py` summarises, `deploy.cjs` taps and drags): both editions at all ten screens (Training Camp, `after/{classic,golden}-WxH.png`), Legendary Peak (Classic neon, Golden Age medina) at 1440x900, 1366x768, 844x390, 768x1024 and 360x640 (`after/*-{neon,medina}-*.png`), `?viewpoint=enemy` at 1440x900 and 390x844 in both editions (`after/*-guest-*.png`), and two high-quality shots (`after/beauty-*.png`). Every one: the far king whole, his plate over his roofs and clear of the screen's edge and the chips, the near plate clear of the edge and the tray; no page or console errors. Before shots: `before/`.

**Hit-testing.** Real input at 1440x900 (mouse) and 390x844 (touch), both editions: a tap (select a card, tap the board) and a drag (press a card, drag it, release) at four tiles each; every troop landed on its tile (within 0.02 tiles: integer touch points). `__cr.scene().pick(arenaToClient(tile))` round-trips exactly at the kings and both lanes, host and guest view, and the board is the topmost element there. The fit tests' pointer-pick cases now include the crown boxes (laptop, landscape phone, tablet with a free column).

**Tests.** `kingExtents.test.ts` (new) builds the towers as the battle does, in both editions, at every flair tier, with hand-built and cast-sized crews, from both viewpoints, and holds the extents in fit.ts against the geometry (within 0.1 units, so they stay tight). `framing.test.ts` (new) runs the layout, the insets and the frustum end to end at the ten screens (plus a taller band, a free king's column, notch and home indicator) and checks the far king's top, both plates and the king's column against the screen, the chips, the tray and the side panels. `fit.test.ts` pins the old box's math with an explicit legacy box and checks the new content (pads and crown) touching the free rectangle; `layout.test.ts` holds the compact hand against the old one around the same content (the old side columns from the legacy box); `layoutCss.test.ts` follows the new board width.

**Quality bar** at the end of the round: `npx tsc --noEmit` clean; `npx vitest run` 142 files / 1,806 tests; `git diff 0a8c97d -- src/game` empty (golden.test.ts and bot.test.ts untouched); `npm run build:all` succeeds (index 325.9 KB gz, +0.5 KB); `tools/perf-budget.mjs --matrix` on the dev server passes every gate:

| View | Edition | Empty calls / tris | Fight calls / tris | Fight textures |
|---|---|---|---|---|
| 390x844@2 | Classic | 100 / 251,206 | 180 / 628,298 | 76 |
| 1440x900@1 | Classic | 106 / 276,298 | 182 / 653,166 | 76 |
| 390x844@2 | Golden Age | 108 / 256,928 | 202 / 659,428 | 75 |
| 1440x900@1 | Golden Age | 116 / 275,132 | 208 / 677,592 | 75 |

## Known gaps after the polish round

These supersede the ship log's list in the art-direction plan (that file is read-only for the polish step). The laptop and landscape framing gap is closed (framing round below).

1. **Golden Age galleries have no horseshoe arcades.** The camera is orthographic and looks straight down the board's length, so a gallery's field-facing side is edge-on; arcades would need the galleries rebuilt as stepped bays with south faces (about a day of stage work).
2. **Outer ring still simple.** Streets, patches, contact shadows, awnings and four limewash tints are in; per-look house kits (heights, parapet styles, market props), a soft edge vignette and per-look pavilion fabric (forge, neon, snow) are not.
3. **Damage numbers from different targets** can still overlap within about 40 px (the merge and stack work per target); a screen-space de-overlap pass across all live numbers is not done.
4. **Tower-fall payoff:** no flying crown to the scoreboard chip and no team-coloured rubble; the collapse, dust and soft scorch are in.
5. **Lava** is one Voronoi scale with no flow; the copper canal's black lip blobs remain.
6. **Archers from behind** still read mostly as pink hair over a sliver of team cape (cast-kit's variant; a team quiver strap would break the cloth-only team rule).
7. **Cast ink is opaque** (the bible asks for 85% alpha) and the set props carry no ink.
8. **Golden Age headgear stays cream** (team bands would break the team rule); with the courts now mid-value the hats separate by value.
9. Carried over: real-device fps (owner), empty-battle triangles at 1440x900 over the 260k target (gate 300k), unbaked `toon()` parts on the old ramp, the procedural Studio champion and blocky mount heads, `?viewpoint=enemy` reset by bot-battle starts (main.ts, frozen).

## Requests for the publish step

- Push `art/ship` (a fast-forward of `claude/game-visuals-character-balance-w122wb`: every commit sits on top of `29f6451`).
- Frozen-file follow-up for its owner (not an art change): keeping `?viewpoint=enemy` across bot-battle starts in main.ts (DEV aid).

