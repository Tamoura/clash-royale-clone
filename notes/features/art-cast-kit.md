# Art package: cast-kit

Modelled cast for "Toy Tournament" (see notes/features/art-direction-2026-11.md, ### cast-kit).
Branch art/cast-kit from art/base (b7ae4ce). Worktree /home/user/wt-art-cast-kit, dev server port 3201.

## Perf (tools/perf-budget.mjs, 390x844@2, quality=high, first arena)

| When | Edition | Empty calls / tris | Fight calls / tris | Fight textures |
|---|---|---|---|---|
| Start (art/base) | Classic | 178 / 266,074 | 431 / 769,750 | 49 |
| Start (art/base) | Golden Age | 167 / 137,566 | 399 / 509,370 | 49 |
| Cast in (b72599d) | Classic | 178 / 266,074 | 259 / 617,388 | 65 |
| Cast in (b72599d) | Golden Age | 167 / 137,566 | 248 / 353,084 | 64 |
| End (fe867fe) | Classic | 178 / 266,074 | 259 / 617,388 | 65 |
| End (fe867fe) | Golden Age | 167 / 137,566 | 244 / 353,144 | 64 |
| End (fe867fe), 1440x900@1 | Classic | 176 / 266,048 | 256 / 617,466 | 65 |

Acceptance ceiling for this branch: fight at most 330 calls, empty at most 200: met in both editions.
Downloads: public/models/troops 808 KB on disk (7 GLBs + CREDITS, budget 1.0 MB). Initial JS bundle
311.7 KB gz vs 294.1 KB gz on art/base: +17.6 KB gz (budget +50); GLTFLoader (13.2 KB gz) and the
meshopt decoder (7.3 KB gz) are lazy chunks loaded with the pack at boot. Pack ready 5-9 s after boot
under SwiftShader with 2 agents on 4 CPUs (dev server, uncached); always before the first battle in
the matrix runs (the home screen and the bot battle start take longer).

## Decisions

- Lean: the body tips about its feet so its front/back turns toward the camera (head away from the
  viewer, a partial billboard): the opposite sign shows MORE hat-top, which is what the critics hated.
- Team colour is two shared uniforms per side (TEAM_UNIFORMS), not baked into atlases: one atlas and
  one geometry per card and edition serve both teams, and a palette switch repaints live units.
- Ink on the cast is silhouette-only: the shell sits 0.3 world units behind the body along the view,
  so hat folds and hood seams no longer draw "V" marks. 1.6 CSS px.
- Team rule test runs on the DEFAULT palette's two hues (blue ~217 deg, red ~1 deg). The colour-blind
  orange (32 deg) would forbid every gold, wood and skin tone; colour-blind players read the side
  from the notched disc and the cloth, as before.
- The old opt-in path is gone: public/models/kaykit (11 MB), glbModels.ts, modelsOptIn.ts and the
  orphan dev page viewer.html + src/viewer.ts (it only loaded public/models/kaykit). Not in the
  package's owned list, but it imported the deleted glbModels.ts and nobody else touches it.
- Troop pack: gltfpack -cc -kn -km -vpf -vtf (float positions and UVs, the bake reads them raw).
- Riders are TWO draws (rider + mount, sharing one material): the mount is a small skinned mesh on six
  procedural bones (body, head, four legs) so it gallops; the rider's legs keep Sit_Chair_Idle while
  idle / walk / attack drive only the upper body (clips split per bone set in loader.bodyClip). The
  mount casts the unit's one shadow.
- Hit flash: the cast's shader MIXES toward the tint (amount = the tint's magnitude, capped 0.6 for
  statuses); troops flash at 0.35 toward #FFF4E0 for 80 ms (troopFlashTint), towers 0.25.
- The team rule is enforced at bake time, not just tested: gradeHsl caps an unrepainted swatch's
  saturation at 0.44 when the boost would push it into a team hue family (leather browns near red).
  A Studio champion's colours go through signatureSafe (hue pushed past the family edge).
- Head x1.12 is baked into the geometry about the neck (no bone scale), so swarms can share poses and
  the HP bar height is exact. Giants use `stretch` (taller body, head carried up) and a smaller head so
  they tower instead of reading as orange balls.
- Swarm pose sharing: units of one card and side (6 or more) copy the leader's 23 bone transforms
  instead of running their own mixer. disposeDeep frees a unit's skeleton and swarm slot
  (group.userData.kitUnit).
- castActiveForBattle() reads a latch set by beginCastBattle(); until ship calls that at battle start
  it follows the pack's state (see Requests for ship).
- Flying Studio champions keep the procedural rig (explicit fallback: the cast has no wings).

## Variant table

Heights are head-top (world units, rider heights include the mount). Every variant lists its
back-visible features in `back` (cast.test.ts checks at least two).

| Card | Classic (body: look; back features) | Golden Age |
|---|---|---|
| knight | knight 2.73: plumed helm, sword, shield, team cape+tabard | spiked steel turban helmet, scimitar, round shield, beard |
| archers | rogue 2.36: pink hair + ponytail, quiver, bow arc, team cape | sand headscarf, pink ponytail, quiver, bow |
| giant | barbarian 3.31 (stretch 1.16, head 0.94): bald + ginger fringe, beard under chin, team mantle, belt | war elephant (creature, not cast) |
| valkyrie | rogue 2.66: two orange braids, winged steel cap, 2H axe | sand headscarf, braids, axe |
| wizard | mage 2.98 (hat): crooked teal hat, flame-orb staff, white beard | ALCHEMIST: emerald turban, alembic staff, green flask |
| musketeer | rogue 2.62: steel morion + finial, musket, purple ponytail | JANISSARY: tall white bork, matchlock, beard |
| mini-pekka | knight 2.53: gunmetal helm + pale horns, cyan visor, 2H sword | DUELIST: spiked steel helm, twin scimitars |
| skeletons / army | skeleton 1.87: skull, bone blade, team cloak | MILITIA 2.02: white turban, tall spear |
| witch | mage 2.66: tall purple hat, pink-gem staff | WAR DRUMMER: plum turban, copper drum, mallet |
| pekka | knight 3.63: long horns, pauldrons, 2H sword, magenta visor | CATAPHRACT: nasal helm, kontos lance, steel-barded horse |
| mega-knight | knight 3.62 (girth 1.15): spiked crest, spiked pauldrons | MAMLUK AMIR 3.72: gold fluted helm, teal-gold plate, mace fists |
| royal-giant | barbarian 3.74: crown on bald head, beard, cannon | BOMBARDIER 3.66: white turban, bronze bombard |
| prince | knight on a white horse 3.67: white-plumed gold helm, lance + pennant | gold turban + aigrette, lance, cream horse |
| hog-rider | barbarian on a hog 3.15: tall mohawk, war hammer | CAMEL RAIDER 3.61: brown turban, scimitar, camel |
| digger | barbarian 2.55: yellow mining helmet + lamp, shovel, pack | TREASURE DIGGER: sand turban, coin sack, shovel, brass lamp |
| princess | rogue 2.61: gold crown, blonde plait, bow | gold circlet, cream veil, bow |
| executioner | barbarian 3.26: tall peaked leather hood, double axe | dark keffiyeh-style hood, double axe |
| electro-wizard | mage 2.75: spiky pale hair, orb in each hand | crest swept back, orbs, gold sash |
| ice-wizard | mage 2.95: frosty hat + icicle, white beard | frosty white turban, white beard |
| magic-archer | hooded rogue 2.37: teal hood, glowing quiver, crossbow | turquoise hood + gold band, quiver |
| firecracker | rogue 2.22: launcher over the shoulder, goggles, amber ponytail | plum rocket tube, sand headscarf |
| champion | from the Studio look (6 headgears x 7 weapons), team cape | same, turbans for none / crown / helmet |
| tower-princess | hooded rogue 2.25 (x0.72 crew): team hood, crossbow | team hood + gold band |
| tower-king | knight 2.87 (x0.72 crew): five-point band crown, white beard, long team cape | crown over a white turban, scimitar |
| cannoneer | barbarian (crew): iron cap, beard, team mantle | sand turban |
| duchess | mage (crew): small crown, hair bun, team cape | circlet, cream veil |

Team colour lands only on capes/cloaks (whole meshes), the knight's tabard swatch, the rogues'
hood-and-cape swatch, the mage's cape swatch, and the discs.

## Screenshots

All under /tmp/claude-0/art/cast-kit/ (iteration shots in it/).

- Contact sheets (battle camera angle WITH the lean; rows: yours behind, yours front, theirs front,
  theirs behind, attack; the phone-size strip top right, two cards per unit, ~40 px tall):
  sheet-classic.png, sheet-golden.png. Rendered by tools/troopview.html (`?edition=golden&bands=2`).
- Standard matrix (shared rules 9): {classic,golden}-{training-camp,barbarian-bowl,pekka-playhouse,
  legendary-peak}-{390x844,1440x900}.png, {classic,golden}-training-camp-390x844-low.png,
  classic-training-camp-390x844-viewpoint-enemy.png (guest camera set after the battle starts),
  golden-courtyard-extras-390x844.png (janissary, duelist, alchemist, militia on both sides).
- Colour-blind palette switched mid-battle: classic-cb-before.png / classic-cb-after.png (the enemy's
  capes, cloaks and discs go from red to orange on units already on the field).
- Walk strip: walk-knight-{0,1,2}.png (the walk clip runs at speed / (clip ground speed x scale), the
  clip ground speed measured from the planted foot at load: loader.measureWalks).
- HP bars mid-fight: it/bars-dbg6.png (outlined pill, team fill, level pip, numbers above).
- Baseline for comparison: /tmp/claude-0/proto/baseline/{phone,desk}.png.

Dev-server note: the fonts 403 in these dev captures (the worktree's symlinked node_modules is outside
Vite's fs allow list), so text uses a fallback face; the production build bundles them.

## Known gaps

- The tower crews come from the cast only once ship wires the provider; until then towers keep the
  hand-built crew (the crews are on the contact sheets).
- The Studio screen's own 3D preview (src/ui/screens/studio.ts, frozen) still uses buildChampionRig;
  the champion's card portrait and its units on the field use the cast.
- Mounts gallop procedurally (no authored clips); their heads are blocky from the front.
- Ink on the cast is opaque (#1C1730-ish via the shared INK colour), not 85% alpha: the shell shares the
  body's opaque draw. OUTLINE_CSS_PX stays 1.25 globally; the cast's shell is drawn at 1.6 px.

## Requests for ship

0. Wiring (shared rules 4 and the cast gate):
   - scene3d.ts: `setTowerCrewProvider(towerCrewProvider)` from `src/render3d/cast/crew.ts` (make() takes the
     VIEWER-relative team, i.e. towers.ts's `teamSide(e.side)`, and "classic" | "golden" from `ARABIC`).
   - main.ts battle start: `await Promise.race([castReady(), sleep(3000)])`, then `beginCastBattle()` before the
     scene resets for the battle (both from `src/render3d/cast/index.ts`). Without it the battle follows the
     pack's state (the pack loads at boot and is in long before the first battle in practice).
   - scene3d.ts (or post.ts) per frame: `RIM_UNIFORM.value = currentQuality().rimLight ? 1 : 0` if the rim must
     follow L4 from somewhere other than updateTroop (cast-kit sets it in updateTroop already).
1. src/render3d/scene/fx/cardwaveFx.test.ts (creatures-fx owns it): the test "troops keep their one-frame
   white snap and warm fade" pins the old white hit flash the art bible forbids. The game no longer uses it:
   troops flash through `troopFlashTint` (animate.ts, peak 0.35 toward #FFF4E0, 80 ms). Replace that test with
   `expect(Math.max(...troopFlashTint(FLASH_TIME, out))).toBeLessThanOrEqual(0.35)` and then delete the
   legacy troop branch of `hitFlashTint` (LEGACY_FLASH_TIME / LEGACY_FLASH_WARM) in animate.ts.

## Progress log

- Worktree created from art/base; B's troop files checked out from proto/kit-everything
  (kitTroops.ts, troop-pack.mjs, troopview.html, public/models/troops, cardportraits.ts, animate.ts, common.ts).
  Start perf measured (table above).
- Cast module split into src/render3d/cast/ (types, loader, bake, rules, props, unit, animate, crew,
  variants.classic, variants.golden (empty yet), palettes, index); kitTroops.ts re-exports it.
  troops.ts ported (kit path under a LEAN node, no name tags, damage-only outlined team HP bars, kit ghost,
  one shadow caster per unit), animate.ts drives the cast (ground-speed walk, Hit_A, Death_A), capped flash.
  Lean sign: the body tips so its front/back turns toward the camera (head away from the viewer).
- Starter-deck variants tuned by eye on the contact sheet (heights in band, giant stretched taller with a
  smaller head and a beard under the chin, hat/hood "V" marks removed with hairBack, witch hair box dropped).
  Team discs thicker (ring from r*0.5) and more saturated (discColor). Troop flash capped (troopFlashTint).
  troops.test.ts updated for damage-only bars. vitest + tsc green.
- Riders (prince, hog-rider; golden cataphract, camel raider) on procedural mounts (cast/mounts.ts); Mega
  Knight, Digger; Golden Age roster complete (variants.golden.ts); champion from the Studio look
  (cast/champion.ts). Team rule enforced in the grade (gradeHsl caps saturation inside a team hue family).
  cast/cast.test.ts: bake budget, team rule (data + every shown swatch), coverage (both editions, crews,
  every Studio headgear x weapon), lean math (home, guest, diagonal), mixer rates, dispose, swarm sharing.
  Portraits come from the cast per edition (softer light for the cast: the "pale knight"); gallery.ts
  shows the cast. Full vitest green (137 files).
- Matrix, contact sheets (banded), colour-blind before/after, guest viewpoint, walk strip captured.
  HP bars fixed: they now ride above the LEANED head and draw on top; popups start above cast units.
  Rim follows the quality level. Perf 259 / 248 fight calls. Build ok, initial JS +17.6 KB gz.
- Final quality bar: tsc clean, vitest 137 files / 1562 tests green, npm run build ok, perf-budget
  passes --max-calls 330 --max-empty-calls 200 in both editions (table above). Second matrix run captured
  after the HP-bar fix.
