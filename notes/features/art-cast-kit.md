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
| Review fix (e22315b) | Classic | 178 / 266,074 | 262 / 631,184 | 65 |
| Review fix (e22315b) | Golden Age | 165 / 137,542 | 245 / 359,160 | 64 |

Acceptance ceiling for this branch: fight at most 330 calls, empty at most 200: met in both editions.
Downloads: public/models/troops 808 KB on disk (7 GLBs + CREDITS, budget 1.0 MB). Initial JS bundle
311.7 KB gz vs 294.1 KB gz on art/base: +17.6 KB gz (budget +50); GLTFLoader (13.2 KB gz) and the
meshopt decoder (7.3 KB gz) are lazy chunks loaded with the pack at boot. Pack ready 5-9 s after boot
under SwiftShader with 2 agents on 4 CPUs (dev server, uncached); always before the first battle in
the matrix runs (the home screen and the bot battle start take longer).
Review fix: the front team cloth adds about 14k triangles to the 12-card fight (drapes are 100-400
vertices each, every variant still under the 9,000-vertex bake cap); the initial JS is 313.0 KB gz
(+1.3 KB for props.drape and the garments).

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
- (Review fix) The side reads from the FRONT too: enemies walk toward the camera and a cape hides behind
  the body. Every variant wears front team cloth from props.teamFront: a TABARD (a curved closed shell
  down chest and belly) on the knight, rogue and mage bodies, front and back on a body without a cape
  (mini-pekka, pekka), short over a rider's lap; a waist SASH with a knot and tails on the bare-chested
  barbarian body (the Giant's sits high, where his belt was); plus a CAPELET where a weapon held across
  the belly hides the front (mini-pekka, pekka, executioner, magic-archer, War Drummer, Mamluk Amir).
  The War Drummer's drum barrel is wrapped in team cloth. The skeletons' team cloak already wraps their
  chest. The champion is dressed the same way. All cloth: true extras, so the team rule still holds.
- (Review fix) Cloth is modelled with props.drape: an elliptical band segment between two heights,
  flaring, with thickness, outward normals and ink. No flat boards (a test forbids box extras with two
  sides over 0.45 and the third under 0.15): the Golden Age veils (princess, duchess) are sand silk shells
  round the back of the head down to the nape (clear of the team cape) with a gold hem; the keffiyeh
  drape is a shell too.
- (Review fix) Our primitives' colours (extras and mounts) carry no palette grade, so their lightness is
  capped at EXTRA_MAX_LIGHTNESS 0.85 at bake (bake.extraColor): CREAM #F5F0E6 bakes as about #E6DBC6.
- (Review fix) Heights: every BODY's head crown is in its band (standard 2.15-2.49, large 2.9-3.5 before
  hats); the art bible's numbers are read as head-top heights, so tall headgear is an accepted exception
  for ship to sign off: wizard hat 2.98, ice-wizard hat 2.95, executioner peaked hood 3.05 (trimmed from
  3.26), janissary bork 3.04 (from 3.21), duelist helm spike 2.91 (from 3.03), Golden knight 2.82 (from
  2.93), Golden treasure digger 2.81, electro-wizard 2.75. The cataphract is 3.65 (from 3.88, the sheet's
  label read 4.18 before the HP-bar fix): a smaller barded horse (size 1.18) and a shorter helm spike.

## Variant table

Heights are head-top (world units, rider heights include the mount). Every variant lists its
back-visible features in `back` (cast.test.ts checks at least two).

| Card | Classic (body: look; back features) | Golden Age |
|---|---|---|
| knight | knight 2.73: plumed helm, sword, shield, team cape+tabard | spiked steel turban helmet, scimitar, round shield, beard |
| archers | rogue 2.36: pink hair + ponytail, quiver, bow arc, team cape | sand headscarf, pink ponytail, quiver, bow |
| giant | barbarian 3.31 (stretch 1.16, head 0.94): pale bald scalp + dark auburn fringe, ginger beard under chin, team mantle, team sash | war elephant (creature, not cast) |
| valkyrie | rogue 2.66: two orange braids, winged steel cap, 2H axe | sand headscarf, braids, axe |
| wizard | mage 2.98 (hat): crooked teal hat, flame-orb staff, white beard | ALCHEMIST: emerald turban, alembic staff, green flask |
| musketeer | rogue 2.62: steel morion + finial, musket, purple ponytail | JANISSARY 3.04: tall cream bork, matchlock, beard |
| mini-pekka | knight 2.53: gunmetal helm + pale horns, cyan visor, 2H sword | DUELIST: spiked steel helm, twin scimitars |
| skeletons / army | skeleton 1.87: skull, bone blade, team cloak | MILITIA 2.02: white turban, tall spear |
| witch | mage 2.66: tall purple hat, pink-gem staff | WAR DRUMMER: plum turban, copper drum, mallet |
| pekka | knight 3.63: long horns, pauldrons, 2H sword, magenta visor | CATAPHRACT 3.65: nasal helm, kontos lance, steel-barded horse |
| mega-knight | knight 3.62 (girth 1.15): spiked crest, spiked pauldrons | MAMLUK AMIR 3.72: gold fluted helm, teal-gold plate, mace fists |
| royal-giant | barbarian 3.74: crown on bald head, beard, cannon | BOMBARDIER 3.66: white turban, bronze bombard |
| prince | knight on a white horse 3.67: white-plumed gold helm, lance + pennant | gold turban + aigrette, lance, cream horse |
| hog-rider | barbarian on a hog 3.12: tall mohawk, war hammer; the hog: round barrel on stubby legs, snout disc, tusks, floppy ears, curly tail | CAMEL RAIDER 3.61: brown turban, scimitar, camel |
| digger | barbarian 2.55: yellow mining helmet + lamp, shovel, pack | TREASURE DIGGER: sand turban, coin sack, shovel, brass lamp |
| princess | rogue 2.61: gold crown, blonde plait, bow | gold circlet, sand silk veil with a gold hem, bow |
| executioner | barbarian 3.05: peaked leather hood, double axe | dark keffiyeh-style hood, double axe |
| electro-wizard | mage 2.75: spiky pale hair, orb in each hand | crest swept back, orbs, gold sash |
| ice-wizard | mage 2.95: frosty hat + icicle, white beard | frosty white turban, white beard |
| magic-archer | hooded rogue 2.37: teal hood, glowing quiver, crossbow | turquoise hood + gold band, quiver |
| firecracker | rogue 2.22: launcher over the shoulder, goggles, amber ponytail | plum rocket tube, sand headscarf |
| champion | from the Studio look (6 headgears x 7 weapons), team cape | same, turbans for none / crown / helmet |
| tower-princess | hooded rogue 2.25 (x0.72 crew): team hood, crossbow | team hood + gold band |
| tower-king | knight 2.87 (x0.72 crew): five-point band crown, white beard, long team cape | crown over a white turban, scimitar |
| cannoneer | barbarian (crew): iron cap, beard, team mantle | sand turban |
| duchess | mage (crew): small crown, hair bun, team cape | circlet, sand silk veil |

Team colour lands only on capes/cloaks (whole meshes), the knight's tabard swatch, the rogues'
hood-and-cape swatch, the mage's cape swatch, the cloth extras (tabards, sashes, capelets, the drummer's
drum cloth, saddle cloths) and the discs. Every variant also wears its front team cloth (Decisions).

Team share of each unit's pixels through the battle camera with the lean (tools/troopview.html
?measure=1, no disc; % of the unit's pixels in its team's hue; theirs front / yours front / theirs
behind / yours behind). Before the review fix the front rows were near 0 for all but the prince, hog
rider and skeletons. After (e22315b): Classic lowest front shares mini-pekka 6.8, pekka 7.9, knight 8.0,
executioner 8.1, magic-archer 9.4; most units 10-24. Golden Age lowest: War Drummer 5.9 before its
capelet, Mamluk Amir 6.7 before its capelet, executioner 8.4, magic-archer 9.0; most 10-15. Full table
in the Progress log.

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
  capes, cloaks, tabards and discs go from red to orange on units already on the field).
- Team share table: tools/troopview.html?measure=1 (script /tmp/claude-0/cast-kit-tools/fix/teamshare.cjs,
  output fix/teamshare-final.txt).
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
   - scene3d.ts per frame, BEFORE the views and the towers update: `setLeanCamera(this.camera)` (from
     `src/render3d/cast/index.ts`). Today only updateTroop sets the lean camera, so with no live troop (battle
     start, the online guest's flipped camera before anything spawns, the home diorama) the crews would lean
     along a stale or default direction (VIEW_DIR starts as the home view, 0,-1). Review finding, read from the
     code: it cannot show until the crew provider is wired. cast.test.ts "cast lean camera" checks the guest's
     flipped camera flips VIEW_DIR.
1. src/render3d/scene/fx/cardwaveFx.test.ts (creatures-fx owns it): the test "troops keep their one-frame
   white snap and warm fade" pins the old white hit flash the art bible forbids. The game no longer uses it:
   troops flash through `troopFlashTint` (animate.ts, peak 0.35 toward #FFF4E0, 80 ms). Replace that test with
   `expect(Math.max(...troopFlashTint(FLASH_TIME, out))).toBeLessThanOrEqual(0.35)` and then delete the
   legacy troop branch of `hitFlashTint` (LEGACY_FLASH_TIME / LEGACY_FLASH_WARM) in animate.ts.
2. Approve two deletions outside the owned list: `viewer.html` and `src/viewer.ts` (the orphan dev page that
   only loaded public/models/kaykit through glbModels.ts, both deleted by the spec; keeping it would break
   tsc). The other wave-1 worktrees still carry the old copies untouched, so the merge takes the deletion.
3. Hat heights: the standard band (2.3-2.7) is met by every body's head crown; tall headgear rises above it
   (wizard 2.98, ice-wizard 2.95, executioner 3.05, janissary 3.04, duelist 2.91). Sign off the exception
   or ask for shorter hats (Decisions, "Heights").

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
- REVIEW FIX (fixer, from 05bcbb7): reproduced all 8 findings on the sheets, battle shots and code.
  2871c20 + e22315b: front team cloth on every variant (tabard / sash / capelet, props.drape), Golden Age
  veils and keffiyeh as draped shells, extras + mounts lightness capped at 0.85, Giant pale scalp + dark
  auburn fringe, hog redesigned (stubby legs, snout disc, tusks, floppy ears, curly tail), cataphract
  3.88 -> 3.65, executioner / janissary / duelist / Golden knight hats trimmed, champion dressed. New tests
  in cast.test.ts (front and back team area per variant incl. every champion look, mount colours, closed
  drapes, no flat boards, colour cap, lean camera). Requests for ship #0 (setLeanCamera per frame), #2
  (viewer deletion), #3 (hat exception) added. troopview: ?measure=1 team-share table, taller strip cells.
  Next: full quality bar (tsc, vitest, build, perf both editions), regenerate sheets, matrix by eye.
- Review fix verified: tsc clean; vitest 137 files / 1569 tests green; npm run build ok; perf-budget passes
  --max-calls 330 --max-empty-calls 200 (Classic 178 / 262, Golden Age 165 / 245). Contact sheets
  regenerated at /tmp/claude-0/art/cast-kit/sheet-{classic,golden}.png: every "theirs, front" cell shows
  team cloth on the body. Matrix re-shot: classic/golden training-camp phone + low, guest viewpoint,
  Golden Age extras (janissary hat now peaks at #F9EEDA, was #FFFEED, no halo), colour-blind before/after.
  Team share after the fix (% of each unit's pixels in its team hue; theirs front / yours front / theirs
  behind / yours behind; blue reads a little lower than red under the warm sun):

```
== classic: % of unit pixels in its team hue (theirs front / yours front / theirs behind / yours behind)
knight               8   8.8  15.5  14.4
archers           16.5  12.4  17.5  14.9
giant             21.9  13.8  28.6  21.8
valkyrie           9.6   7.1  11.9  10.8
wizard            11.7   8.5   9.1   6.5
musketeer         12.7    10  13.9  12.7
mini-pekka         6.8   5.7  15.5  15.5
skeletons         13.1  10.7  13.9  11.2
witch             11.5   8.4   8.5   5.9
pekka              7.9   6.8  16.7  16.7
ice-wizard        10.4   7.5   8.3     6
electro-wizard    14.4  10.8    17  13.4
magic-archer       9.4   7.9  20.9  19.2
princess          15.8    12    16  13.7
firecracker       13.4    10  14.1  12.4
executioner        8.1   5.2  24.7  23.8
royal-giant       14.4  13.2    24  21.5
prince            11.3    11  10.6  10.5
hog-rider         18.6  17.1  14.2  13.4
mega-knight          9     9  17.2  17.3
digger              14  10.8  13.1  10.5
tower-princess    50.5  49.3  67.4  65.4
tower-king         9.2   8.8  22.5  22.3
cannoneer         13.5  10.4  20.6  18.5
duchess           13.7  10.3  15.6  12.4
champion            14  11.1  16.7    15
== golden: % of unit pixels in its team hue (theirs front / yours front / theirs behind / yours behind)
knight             9.6   9.3  14.3  13.8
archers           15.3  11.7  15.7  13.3
valkyrie           9.1   6.6  10.1   9.1
prince            11.8  11.4  10.2  10.1
princess            15  11.5  14.6  12.6
executioner        8.2   5.3  13.9    13
electro-wizard    11.8   8.3  16.6    13
ice-wizard        10.7   7.6  13.2  12.2
magic-archer         9   7.8  19.8  18.1
firecracker       12.6   9.5  11.8  10.5
musketeer         10.3     8  12.1  11.1
mini-pekka        12.1   8.5  11.9  11.8
witch                8   7.2  16.5  13.9
wizard            10.7   7.7  12.5   9.8
pekka             11.2  11.1  10.5  11.2
mega-knight       10.4  10.4  20.4  20.4
skeletons         12.9   9.9  13.2  11.3
royal-giant       12.5  11.4  21.5  19.4
digger            12.1   9.3  11.7   9.4
hog-rider         13.6  11.6   8.2   7.4
tower-princess    43.1    42  59.6  57.6
tower-king         9.3   8.9  22.1  21.8
cannoneer         12.1   9.3  18.5  16.7
duchess           13.3    10  10.4   7.3
champion            14    11  16.7  14.9
```

