# card-wave-art: the new cards come to life

Wave-2 package (plan `/tmp/claude-0/enh/plan-wave2.md`). Sim v3 shipped the
Stone Golem, its Pebble Golem token, the Digger and the Comet with borrowed
rigs, a hidden tunnel and no Comet telegraph. This package gives them their
own art, effects and sounds in both editions, adds a trial battle per card
(playable while the card is locked), retunes the challenge stars, adds a
one-time "New cards!" Home sheet, and softens the tower hit flash.

No sim changes: `golden.test.ts`, `bot.test.ts`, `SIM_VERSION` and
`PROTOCOL_VERSION` are untouched. Everything new reads the battle state and
never writes it.

## What changed

### 1. Rigs (`render3d/characters3d.ts`, `anim/archetypes.ts`)
| Card | Classic | Golden Age (`ISLAMIC_BUILDERS`) |
|---|---|---|
| Stone Golem | `buildStoneGolem`: a mossy granite boulder body, a small head sunk under a heavy brow, two glowing mint eye gems, moss on the crown and shoulders, chiselled cracks, boulder fists, a team crystal in the chest and team rune bands | `buildSandstoneGolem`: a carved sandstone block guardian with a domed head and brass finial, a turquoise eight-point (girih) star, brass cuffs, turquoise eye gems and a team sash |
| Pebble Golem | `buildPebbleGolem`: a small round rock with big eye gems, a moss tuft and a two-leaf sprout, a team pebble-gem | `buildSandPebble`: a little sandstone block with a dome, turquoise eyes and a team plinth band |
| Digger | `buildDigger`: a miner with a brass hard hat and glowing headlamp, big nose and moustache, team neckerchief and braces, pickaxe | `buildTreasureDigger`: a desert treasure-digger with a team turban, sand robe and team sash, a coin sack, a brass oil lamp with a flickering flame, and a shovel |

- Boulders are lumpy icosahedra (`boulderGeo`: corners jittered by a
  position hash, flat-shaded, cached per radius/seed); ink hulls use the
  smoothed outline normals, so the outline has no gaps.
- The eye gems throb in idle (`extras`); the treasure-digger's lamp flickers.
- `buildCometRock()`: a basalt boulder with glowing lava veins, used by the
  Comet's portrait and its fall in battle.
- Palette audit, team-part and bake tests pass in both editions: every new
  rig has team parts, bakes to <= 14 meshes / 5 materials.
- Archetypes: golems `slam` (heavy / medium), Digger `chop` (quick: 1.2 s
  hit speed). The Stone Golem's footfalls thud (dust + a 0.05 camera bump per
  step, `STOMPERS` in `views/animate.ts`; reduced motion skips the bump).
- `views/troops.ts` scales the Stone Golem as a tank.

### 2. Portraits and card art
- Troop portraits come from the new rigs automatically (`cardportraits.ts`).
- The Comet is the first spell with a 3D portrait (`SPELL_PORTRAITS`): the
  rock dives down-left under three flame shells and embers.
- `render/characters.ts`: 2D painted fallbacks for the three troops and the
  Comet's flaming-rock art (`drawCardArt`), for when no WebGL portrait can be
  captured. `cardcolors.ts` already had colours for all four ids.

### 3. Digger tunnel and emerge (`scene/fx/burrow.ts`)
- While `burrowTimer > 0` a dirt mound (team ring underneath) ploughs from
  the Digger's own King tower (where the sim starts the tunnel) to the dig
  spot. Its position is `burrowProgress(burrowTimer, burrowTotal, alpha)`,
  so it arrives on the `emerge` tick. It leaves a dark furrow and flicks clods.
  The dig spot keeps a team ring for the whole dig. Loam on grass, sand in
  the Golden Age bazaar.
- `emerge`: `diggerEmerge` bursts a `dirt-burst` fountain (chunky clods and a
  dust cloud, twice), a dust ring, a lingering dark hole and a crater decal,
  with a small camera bump. The Digger then climbs out of the hole (spawn
  recipe `rise`, held while burrowed). No falling deploy shadow and no
  sky-drop puff for a tunneller.

### 4. Comet fall and impact (`scene/fx/comet.ts`)
- During `landDelay` each `BattleState.pendingSpells` entry gets a pooled
  view: a pulsing caster-coloured ring that beats faster as the rock nears, a
  hot ring closing in onto the radius, a growing fill and shadow, and the
  rock streaking down with a flame tail and embers.
- The rock's position is `cometProgress(ttl, landDelay, alpha)` through
  `cometPosition()`: from high beyond the target (as the camera sees it,
  either viewpoint) and off the caster's right, easing in. It reaches the
  ground exactly when the sim lands it. The test plays a real cast tick by
  tick: the frame before tick 54 draws it on the ground, and tick 54 raises
  `spell-land` and takes the tower from 2534 to 2134.
- `spell-land`: flash, two shockwaves past the radius, fire core and
  billows, rock chunks and embers thrown from above the ground (so the blast
  still reads on a tower), an ember bed, crater and scorch decals, camera
  shake, a 2-frame screen flash (skipped under reduced motion) and a 60 ms
  hit-stop.
- The cast only pops a ring; troops' recoil now follows the landing, not the cast.

### 5. Stone Golem death
- `deathStyle` `crumble` (stone chunks, grit, a dust ring) and `shatter`
  motion for both golems: the baked body flies apart.
- The two pebbles pop out of the golem's middle: `popPose` (spawnfx.ts)
  holds them hidden 0.12 s while it crumbles, then hops them out on a
  parabola to their own spots, with the drop's landing squash.

### 6. Sounds (`audio/sound.ts`, `audio/wire.ts`)
`waveCue(ev)` maps the moments to synth cues:
- the Digger's dig-in crunch and rumble (no landing thump), and its cartoon
  pop on `emerge`;
- the Comet's whoosh, swelling over the 1.8 s fall, and its boom on
  `spell-land`;
- the Stone Golem grinding onto the field, and its crumble (smaller for a
  pebble).

`wire.ts` adds a haptic thud for a Comet landing and a golem crumbling.

### 7. Deploy overlay (`main.ts` selectCard, the one declared line)
`scene.setZoneVisible(visible, card)` now takes the effective card. A
`deployAnywhere` troop (the Digger) shows both enemy lanes as deployable:
no dark enemy half, no red edge, no King keep-clear disc (`deploysAnywhere`,
`zoneParts`).

### 8. Blurbs (`render/cardBlurbs.ts`)
Lines in both editions for the Stone Golem, Pebble Golem, Digger ("Drop it
right next to a tower!") and Comet. The test now covers every deckable card
and token.

### 9. Trials and the star retune (`game/challenges.ts`, `ui/screens/challenges.ts`)
- `TRIAL_CHALLENGES` / `trialFor(id)`: "Try the Stone Golem!" (0:50), "Try
  the Digger!" (0:40) and "Try the Comet!" (0:40). Each is one star, 30
  first-clear gold, with a fixed deck built around the card, so it plays
  while the card is locked. Their waves suit the card: the Comet's are slow
  shooters walking in clumps. Golden Age names are حارس الحجر, حفّار الرمال
  and الشهاب.
- The Challenges screen lists the trials first ("Try the new cards"), each
  with the card's portrait and an "Unlocks in Bone Pit (200 trophies)" chip,
  then the puzzles.
- Star retune. After sim v3 the Normal bot cleared every challenge 10/10.
  The waves were retuned and three challenges re-rated: Sky Pirates 2 to 3
  stars, The Horde 3 to 2. Clear rates (`challenges.test` harness, Normal
  bot `thinkInterval 1, pushAt 8`):

| Challenge | Stars | Normal, seeds 1-30 | Normal, seeds 1-10 (the test) | Easy, seeds 1-30 |
|---|---:|---:|---:|---:|
| 3 trials, 3 starters | 1 | 30/30 each | 10/10 each | 30/30 each |
| Air Raid | 2 | 29/30 | 10/10 | 25/30 |
| The Horde | 2 | 22/30 | 6/10 | 22/30 |
| Hog Rush | 2 | 30/30 | 10/10 | 30/30 |
| Mega Drop | 2 | 21/30 | 7/10 | 30/30 |
| Witch Party | 2 | 17/30 | 7/10 | 30/30 |
| Skeleton Storm | 2 | 23/30 | 10/10 | 30/30 |
| Giant Trouble | 3 | 15/30 | 6/10 | 11/30 |
| Sky Pirates | 3 | 14/30 | 4/10 | 14/30 |
| Bridge Spam | 3 | 9/30 | 5/10 | 0/30 |

  Means (Normal, seeds 1-10): one-star 10.0, two-star 8.3, three-star 5.0.
  `challenges.test` keeps solvability (one-stars and trials >= 8/10, all
  >= 2/10). A new case checks that every three-star clears at most 7/10 and
  that the means fall from one star to three. Every blurb names its new
  waves in both editions ("Three Giants with shooters behind them",
  "Five Witches...").
- The tuning was iterative: the Horde's outcome is decided by its first
  20 s, so most variants clear either 1/10 or 10/10 on the test seeds.

### 10. "New cards!" sheet (`ui/newCards.ts`, `ui/styles/newcards.css`)
- A dialog over Home (the `battle-top` home slot). It shows the three cards'
  portraits, names, blurbs, an "Unlocks in ..." line while a card is locked,
  and a "Try it" button that closes Home and starts the trial. "Got it",
  the close button, Escape or a tap outside close it.
- Shown once: closing sets `cr-clone-newcards-seen`. It waits until the guided
  battle is done (`TUTORED_KEY`), and unreadable storage counts as seen.
  Switching tabs takes it down without marking it seen.
- It is mirrored for Arabic, still under reduced motion, and side by side in
  landscape. All text goes through `tr`, and it uses icons only (no emoji).
- `registerNewCards(ctx)` wires it (see the integrator note: it needs the
  app context).

### 11. Tower hit flash (`views/animate.ts`)
Towers and buildings no longer go full-white for a frame on every hit. They
get a soft warm throb instead (`hitFlashTint`: a peak of 0.26, over 0.22 s).
Troops keep their one-frame white snap. Measured in a battle where three
Knights took a princess tower from 2534 to 134: the tower's emissive peaked
at 0.22 (it was 1.0 before).

## Notes for the integrator
- **One line in main.ts is needed to switch the New cards sheet on.** Starting
  a challenge needs `AppCtx.startChallenge`, and no slot or hook carries the
  context. Add `registerNewCards(ctx);` right after `registerRewards(ctx);`
  (main.ts ~863), with `import { registerNewCards } from "./ui/newCards";`.
  The plan allows this package one main.ts line, in `selectCard`, so that
  call is not in this branch. I verified the sheet with it applied as a local,
  uncommitted patch (results below). No other wave-2 package edits main.ts,
  so the call can't conflict.
- `src/main.ts` diff in this branch: the `selectCard` line only (it passes
  the effective card to `setZoneVisible`).

## How it was verified
- `npx tsc --noEmit`, `npx vitest run` (127 files, 1424 tests) and
  `npm run build` pass.
- New tests:
  - `render3d/cardwaveRigs.test.ts`: the rigs in both editions;
  - `render3d/cometPortrait.test.ts`;
  - `render/characters.test.ts`: the 2D art;
  - `render3d/scene/fx/cardwaveFx.test.ts`: the Comet's exact-tick landing
    on a real cast, the tunnel and its mound lifetime, the pop pose,
    crumble/shatter, and the tower flash bound;
  - `render3d/deployZone.test.ts`;
  - `audio/cardwaveSound.test.ts`: cues, synthesized voices, haptics;
  - `ui/newCards.test.ts`: rows, the seen flag, lock text;
  - extended `cardBlurbs.test.ts` and `challenges.test.ts`.
- Golden/bot fixtures, `version.ts`, `protocol.ts`, `sim.ts`, `battle.ts`,
  `cards.ts` and `bot.ts` are unchanged since `6736388`.
- Draw calls (`tools/perf-budget.mjs`, 390x844@2, `?quality=high`): Classic
  empty 154 / fight 377, Golden Age 165 / 399 (budgets 220 / 450). The same
  fight with the Stone Golem and Digger in place of the Giant / P.E.K.K.A /
  Mini P.E.K.K.A / Hog Rider: 397 Classic, 394 Golden Age.
- Headless Chromium (dev server :3801, DPR 1, SwiftShader):
  - Gallery `?gallery=<id>&quality=high` front and side views of the three
    rigs in both editions. Also an in-battle line-up at `?quality=high` in
    both editions: all six rigs read as themselves.
  - Sandbox, Digger tapped in the hand: `zoneParts` = no enemy dark, no
    red edge, both lanes blue, no King disc. Dragged to (7, 10): the mound
    travels from the King leaving the furrow; on `emerge` (presentation
    frozen through a hit-stop to catch it) the burst, hole and crater show;
    the Digger rises and walks to the tower. Same in the Golden Age edition.
  - Comet on a princess tower and on a pack of Knights, with the sim held at
    0.4 / 0.9 / 1.3 / 1.65 s: the ring pulses and closes, and the rock streaks
    down from the upper right. A per-frame log shows its height falling
    (7.7, 6.3, 3.4, 1.1) and the tower's HP dropping 400 on the frame the rock
    is gone. Same in the Golden Age edition.
  - Stone Golem killed: it crumbles, its parts fly apart and 2 pebbles hop out.
  - With the wiring line applied: the sheet shows on a fresh, tutored Home
    at 390x844, 360x740 (scrolls inside), 844x390 (rows side by side) and
    1280x800, in both editions, with no horizontal scroll. "Try it" on the
    Digger starts the trial with the Digger in hand while the profile owns
    only the starter cards. After "Got it" or "Try it" the seen flag is set,
    and a reload shows no sheet.
  - The Challenges screen (500 trophies): the three trial rows lead, with
    portraits and lock chips, at 390x844 and 1280x800 (Golden Age), with no
    horizontal scroll.
  - No console or page errors in any run (only SwiftShader's GPU-stall warnings).

## Known gaps / follow-ups
- The sheet needs the `registerNewCards(ctx)` line above.
- SwiftShader runs at about 13 fps, so the emerge and impact bursts were
  judged on frozen frames and a probe. A real-GPU look is worth a pass for
  the particle sizes.
- The Comet on a tower: the crater and scorch sit under the tower body, so
  only the airborne part of the blast reads there (by design).
- Bridge Spam is 0/30 for the Easy bot: it is the hardest three-star.
