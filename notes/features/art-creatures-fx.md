# Art package: creatures-fx

Creatures, card buildings and every effect in the KayKit cast's material language, both editions.
Spec: `notes/features/art-direction-2026-11.md` (### creatures-fx, Art bible sections 5, 7, 8).
Branch `art/creatures-fx` from `art/base` (b7ae4ce). Worktree `/home/user/wt-art-creatures-fx`, dev port 3202.

## Decisions

### Damage numbers (popups.ts, scene/fx/glyphs.ts)
- Every number is gold `#FFD23F` (DAMAGE_GOLD) with a 3 CSS px `#1D1630` stroke and a soft drop shadow,
  in Lilita One. The glyph atlas keeps three masks in three channels (red fill, green stroke, blue blurred
  shadow); the shader composites shadow, ink and fill, and shades the fill a touch lighter at the top.
  One texture still serves every colour. Golden Age digits are unchanged (the same Western digits).
- Size says how big the hit was: 1.0 / 1.12 / 1.3 (crit, with a star). Tower hits print at least 1.3x
  (`towerHitLabel`; effects.ts finds the tower under the popup by position, since animate.ts passes no kind).
- Hits on the same target (same screen spot) within MERGE_WINDOW = 150 ms merge into one number.
  A new number that would overlap one still rising stacks above it for the rest of both lives
  (`stackLift`, a view-space lift in the spare `aG.w` attribute). Legible on lime grass, snow, lava
  and courtyard plaster (see the mid-fight shots).

### Bloom contract (art bible 5)
- Only cores and sparks carry hdr above 1 (HOT_PRESETS: hit stars' core, crit, muzzle, embers, sparks,
  zap sparks, rage embers, portal embers, spark burst, fireball core, dust-kick sparks), at most 2.4 and
  small. Rings, puffs, flames and impact glows draw in the alpha pool or at hdr <= 1 (PLAIN_HDR_MAX),
  so they never brighten what is under them past their own colour. Decals clamp to rgb <= 1
  (DECAL_MAX_RGB). Screen flashes are capped at FX_MAX_FLASH = 0.25 in VfxPool.flash (zap now asks 0.22).
- Rig glow parts (eyes, runes, fuses, elixir) are scaled to linear luminance <= 0.8 (RIG_GLOW_MAX,
  `underBloom`). The comet's lava veins are the one rig part allowed past it (a comet core).
- Rig tints MIX toward their colour (never add light): hit flashes (white or warm-white tints) at most
  0.35 (RIG_FLASH_MAX), statuses (freeze, rage, slow) at most 0.6. So no flash can blow a troop to white,
  even with base animate.ts's one-frame white snap.

### FX restyle (scene/fx/**, projectiles.ts, impactfx.ts, deathfx.ts)
- Particle atlas: smoke cells repainted as toon clouds with a thin ink rim and two ramp tones (a tinted
  puff can never read as an opaque white blob); new cells STAR5 (inked five-point star), FLAME3 (toon flame
  in its own three tones), PUFF (ribbon puff), ARROW (fletched arrow sprite), FPETAL (flame petal); chips
  are ramp-shaded (1.0 / 0.86 / 0.62) with an ink rim. Fixed the PLUS cell (its two arms were two paths,
  so only the bar showed).
- Floor dust (dust, deployPuff, debris, chips, bones, dust-kick) takes the arena floor's dust colour
  (`floorDust(LOOK)`: 90% lane, 10% floor or plaster, held mid-light and muted). Smoke takes the effect's
  colour. Impact puffs are capped at IMPACT_PUFF_MAX = 1.2 tiles (Layer.maxSize).
- Hit sparks are 4-6 inked gold stars (`hitStars`) plus a tiny hot core; impact colours are warm golds.
- Projectiles are modelled (projectiles.ts `form`): fireball (wizard, baby dragon, firecracker) = a hot core
  above the threshold in a pinwheel of three toon flame petals, shedding a smoke ribbon, flame licks and
  embers (no cone anywhere); fletched arrows in one draw (shaft, steel head, three feathers; magic and
  flaming arrows add a small hot tip); a musket tracer (hot head fading to a tail); an electric bolt that
  crackles segments along its path; an ice shard shedding frost; orbs keep their hue (the witch's purple).
- Spells: a two-tone team ring (team band, white inner rim, faint fill; the band ends at the decal's edge,
  so the ring is at the true radius) for every spell (`spellRing`, colour `fxTeamColor`: viewer-relative
  and colour-blind aware); lasting spells keep it for their life; the king's rally and restore too.
  Fireball: comet = core + three spinning FPETAL petals + smoke ribbon; impact = toon flame tongues over
  fire-lit billows cooling to ash, embers, a few chips, scorch. Arrows: fletched arrow sprites turned along
  their flight. Zap and freeze glints toned down. Tornado puffs capped.
- Deploy: the telegraph ring is the two-tone team ring; the landing throws floor dust plus a team-colour
  burst (ring and stars). The local deploy flash is a soft team-colour ground glow, not white.
- Deaths are tinted (creature colours, a dusty violet-grey default); dull death colours throw ramp chips
  instead of glowing sparks (`emitSparks` sends stone and dust colours to chips: masonry never glows).

### Feel (hitstop.ts, shake.ts)
- Hit-stop: MAX_HITSTOP 0.25 s; after a freeze, light punches (< BIG_HITSTOP 0.1 s) rest for REST_AFTER
  0.2 s, so a brawl reads as clean beats, not a stutter. Big beats always land.
- Shake: kicks stack with diminishing returns, trauma caps at MAX_TRAUMA 0.85, drains at 1.8/s.

### Material language for rigs (characters3d.ts, rigBake.ts)
- Baked rig materials (bakedToon / unitBakedToon / teamToon) take the cast's language, with constants held
  locally (RIG_*): ramp 0.62 / 0.86 / 1.0 with soft 0.04 edges, cool rim #BFE3FF at 0.35 (RIG_RIM_UNIFORM,
  off with the quality level's rim light), ground occlusion on the lowest 18% (up to 15%, per-unit uAoTop),
  silhouette-only ink at 1.6 CSS px (the shell pushed 0.3 behind the body), mix-only tints.
- Bake-time albedo grade (`gradeRigHsl`): the build-time toon boost becomes saturation x1.12 with the cast's
  lift; greys go a touch cool; a colour the boost would push into a team hue family stays under it.
- The humanoid rigs are the procedural fallback: they get the same constants, no redesign.

### Creatures (both editions): one team slot each
| Card | Classic | Golden Age |
|---|---|---|
| baby-dragon | green dragon, ivory horns, spine ridge, spade tail, leafy wings; team **scarf** (tails fly behind) | roc hatchling, feathered gold wings; team **scarf** |
| balloon | sunflower envelope with cream ribs, team **stripe** on the upper shoulder, goggled skeleton pilot, bomb | fire kite, turquoise sail tipped back to face the camera; team **tails** |
| bats | violet, big ears, membrane wings; team **collar** | (same card art) |
| minions | purple-grey imps (never blue), ivory horn, snub nose; team **bandana** | war falcon, barred wings; team **hood** |
| gargoyles | stone imps, curled horns, stone wings; team **collar** | war falcon; team **hood** |
| stone-golem | mossy boulder, rune-glow arm bands; team **chest crystal** | sandstone guardian; team **sash** |
| pebble-golem | mossy pebble; team **chest gem** | sandstone block; team **plinth band** |
| giant (Golden Age) | (cast) | war elephant at ELEPHANT_SCALE 0.72 (head-top ~3.5, in the large band); team **saddle cloth** + blanket |
| cannon | bronze barrel on a timber carriage; team **pennant** | brass with a turquoise muzzle; team **pennant** |
| tombstone | rounded headstone, carved skull, soul-light; team **wreath** | sandstone stele, turquoise band; team **wreath** |
| elixir-collector | hooped vat, pink elixir and drop, pump; team **rim band** | brass vat; team **rim band** |
| comet rock | dark rock, hot lava veins (a comet core) | same |

Buildings are new `buildBuildingRig(cardId, side)` rigs (BUILDING_IDS) that bake like troops; the cannon's
barrel is an animated node the scene aims. They need wiring in troops.ts (Requests for ship 1).
`tools/creatureview.html` (dev only) is the creature and building contact sheet through the battle camera
with the cast's 14 degree lean, both teams, front and back, plus a 40 px strip (`?edition=golden`,
`?cards=a,b`, `?palette=cb`).

## Perf budget

Measured with `node tools/perf-budget.mjs --url http://127.0.0.1:3202 [--edition arabic]` (390x844@2, quality=high, first arena).

| When | Edition | Empty calls | Empty tris | Fight calls | Fight tris | Fight textures |
|---|---|---|---|---|---|---|
| start (b7ae4ce) | classic | 178 | 266,074 | 435 | 769,710 | 49 |
| start (b7ae4ce) | golden | 167 | 137,566 | 399 | 509,394 | 49 |
| mid (7c3800b) | classic | 178 | 266,074 | 429 | 788,828 | 49 |
| mid (7c3800b) | golden | 167 | 137,566 | 395 | 530,052 | 49 |

Package ceiling: fight calls <= base + 10 (classic 445, golden 409); fight triangles <= base + 5% (classic 808k, golden 535k).

## Screenshots

All in `/tmp/claude-0/art/creatures-fx/`:
- `creatures.png` (both editions, every creature and building, both teams, front and back, 40 px strips),
  `creatures-classic.png`, `creatures-golden.png`.
- `fx.png` (Classic, training-camp) and `fx-golden.png` (courtyard): each spell, hit, deploy, death and
  projectile, quality=high, cropped and scaled to 3x CSS.
- `midfight-{classic,golden}-{training-camp,pekka-playhouse}-390x844[-b].png`: bot fed elixir.
- Standard matrix: `{classic,golden}-{training-camp,barbarian-bowl,pekka-playhouse,legendary-peak}-{390x844,1440x900}.png`
  and `{classic,golden}-training-camp-390x844-low.png`.
- Baseline for comparison: `/tmp/claude-0/proto/baseline/{phone,desk}.png`.

## Known gaps
- Creatures get the 14 degree lean from cast-kit's troops.ts `leanNode` once merged; this branch has no lean
  in battle (the contact sheet applies it).
- Non-humanoid card portraits (cardportraits.ts) render unbaked rigs with `toon()` (C's coloured ramp), so
  they lack the baked grade until ship unifies the materials.
- Bats' team collar is a few pixels at phone size; their team disc carries the side.
- The arrows spell volley is drawn as fletched arrow sprites (2D, turned along the flight), not meshes.
- Stone golems show their team crystal from the front only (the disc carries it from behind).

## Requests for ship

1. **Wire the card buildings** (`src/render3d/scene/views/troops.ts`, cast-kit's file): replace the hand-built
   meshes in `buildBuildingMesh` (and drop `buildTombstoneMesh` / `buildCollectorMesh`) with the baked rigs:
   ```ts
   import { buildBuildingRig } from "../../characters3d";
   export function buildBuildingMesh(e: Entity): EntityView {
     const root = new THREE.Group();
     const team = teamSide(e.side);
     const rig = buildBuildingRig(e.cardId!, team)!;
     bakeRig(rig, `${e.cardId}:${team}:${ARABIC ? "arabic" : "normal"}:${teamPalette()}`);
     root.add(rig.group);
     const bar = makeHpBar(1.4, unitHpColor(team), rig.barY);
     root.add(bar.group);
     trackTeam({ root, side: team, hpFill: bar.fill });
     return { root, rig: null, hpGroup: bar.group, hpFill: bar.fill, barrel: rig.barrel,
       flashMats: collectFlashMats(root), lastHp: e.hp, flashT: 0, spawnT: 0, isTroop: false };
   }
   ```
   The palette repaint (onPrefs) must re-run `applyTeam` on building rigs like it does for troops.
2. **cardwaveFx.test.ts** (this package's file) still pins the old one-frame white troop flash
   ("troops keep their one-frame white snap and warm fade"); cast-kit asked ship to replace it with
   `expect(Math.max(...troopFlashTint(FLASH_TIME, out))).toBeLessThanOrEqual(0.35)` once its animate.ts lands
   (troopFlashTint does not exist on the base, so wave 1 could not). The rig shader caps flashes at 0.35 either way.
3. **One material module**: the baked rigs use RIG_* constants in characters3d.ts that mirror cast/bake.ts
   (ramp, rim, AO, ink 1.6 px and depth 0.3, saturation 1.12, mix tints). Point both at one module, and tie
   `RIG_RIM_UNIFORM` to the cast's `RIM_UNIFORM` (today it follows `currentQuality().rimLight` in animateTroop).
   `toon()` (unbaked: towers' bits, arena props, portraits) still uses C's coloured ramp and old rim.
4. **animate.ts deploy countdown ring** (cast-kit's file) is an opaque white ring (0.75): make it the team
   colour or cream to match the two-tone deploy ring ("nothing opaque white").
5. **animate.ts damage popup lift**: towers have no rig, so their numbers spawn at 2.4, inside the keep; pass
   the tower top (the HP plate height) instead. Tower hits already print 1.3x (effects.ts finds the tower).
6. **post.ts** (stage): stage caps setFlash at MAX_FLASH 0.25; VfxPool also caps at FX_MAX_FLASH, keep both.

## Progress log

- Worktree created from art/base; perf base recorded (table above).
- 5d19b43 Damage numbers: gold fill, dark stroke, drop shadow, merge and stack.
- 33d366d FX under the bloom contract, toon puffs/flames/stars, modelled projectiles, team spell rings, rig material language.
- 7da480f + 6fb5376 Creatures with one team slot each, bake grade, rune glows, card buildings (buildBuildingRig), slimmer elephant, wings, creatureview tool, tests.
- 7c3800b hit-stop and shake retune, flash cap in the rig shader, billow colours; 96e7a05 FX tests; flash cap broadened to warm-white tints.
- Mid-fight shots (both editions, training-camp and pekka-playhouse) taken and checked by eye.
- NEXT: standard matrix (running), creatures.png and fx.png sheets, end perf, quality bar (tsc, vitest, build, perf both editions).
