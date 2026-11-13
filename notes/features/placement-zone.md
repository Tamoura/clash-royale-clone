# Feature: placement zone ("where can I put it after a tower falls?")

The owner (a parent) asked: "where to place in after the first tower down is
confusing, make it clear visually."

Before this change the only "yes" was a 12% blue wash nobody could see
(pocket luminance 171 → 172 against a no-card control), the King keep-clear
was a 20% red disc (colour only, cut by a seam through the King tower),
nothing at all happened on screen at the moment a lane opened, and a good
spot with too little elixir showed the same red disc as a bad spot. The
before shots are in `/tmp/claude-0/place/before/` (S1-S8).

Now the board itself is the answer: one exact deploy map, drawn on one
plane from the sim's own rules, that lights the new pocket up the moment a
lane opens.

## 1. What the kid sees

Shots (DPR 2, SwiftShader, staged with `/tmp/claude-0/place/stage.cjs`):
`/tmp/claude-0/place/build/final/`; before / after sheets:
`before-after-phone.png` (S1, S5, S2, S6) and
`before-after-golden-guest.png` (S3, S8) in that folder.

1. **The tower falls, no card held** (`reveal/S5-fall-*.png`). For 0.6 s
   nothing new: the collapse, the crown and the bot's emote read first.
   Then the opened pocket lights up as a disc growing from the ruin, with a
   white front, over 1.0 s (`S5-fall-1.0.png`, `S5-fall-1.2.png`). Nothing
   is drawn outside the disc; inside it the pocket shows its final look: lit
   ground, a bold white line along its river bank and along the middle seam
   (only while the other lane is closed), and the King's keep-clear as a
   striped bite with an outlined arc. From 1.0 s to 4.0 s a label pill
   with an open padlock sits in the pocket: **"Drop troops here now!"**
   (`S5-fall-2.2.png`). The pocket fades out at 4.0-4.6 s and the board is
   normal again (`S5-fall-4.8.png`). Replays play the same reveal (no
   label); the tutorial plays it with no label (its coach owns the words).
2. **Holding a troop or building** (`S1`, `S3`, `S4`, `S6`, `S7`, `S8`).
   The whole map: your half untinted with a white line just inside your
   river bank; the opened pocket lit and outlined, the brightest thing on
   the board; everything you may not use darker with 45-degree ink stripes
   (the closed lane, the King's bite; the river calmer, no stripes). With
   both towers down (`S6`) the two pockets are one, with no middle line.
   If a lane opens while a card is held, that lane cross-fades from its
   closed look to its open look over 0.25 s.
3. **Pointing at a spot** (`S1` yes, `S2` no, `extra/S1-wait.png` wait).
   A pip floats over the pointer (62 px above a finger, 40 px above a
   mouse): a tick, a no-entry sign or an hourglass. Different shapes and
   sizes, so colour is never the only cue. On a "no" spot the ghost fades
   to 40% and the map's outline thickens (x1.35), calling the finger back
   inside. Too little elixir on a good spot is the hourglass and a GREEN
   disc: red only ever means "wrong place". The verdict is re-read every
   frame, so a tower falling or elixir arriving under a still finger flips
   it at once; pressing on the field shows the map, ghost and pip before
   the finger lifts.
4. **A refused drop** (`tap/*-words.png`). The words at the finger say
   which rule: "Knock down this tower first!" (the other, closed lane),
   "Too close to the King!", "Not in the water!", "Can't dig here!", or
   "Your side only!" while no lane is open yet. The region the words mean
   flashes white twice over its not-allowed ground, the outline thickens
   for 0.8 s, and the red ring pulses as before. The hand row no longer
   shakes for a bad spot (it still does for elixir): the answer is on the
   field.

## 2. The rule and how the shape is derived

`src/game` is untouched (`git diff eeaee3b -- src/game` is empty;
SIM_VERSION and PROTOCOL_VERSION stay 3). The shape comes from the sim's
exported functions in `src/render3d/deployZone.ts`:

- allowed = your dry half, plus each open lane's dry enemy half
  (`openLanes`; ONE rectangle when both are open, so no seam), minus
  `circle(enemy King, 4.5) ∩ enemy half`, minus
  `circle(each standing enemy princess, 3) ∩ enemy half`;
- towers sit at `towerSpots(opposite(side))`, a princess stands exactly
  when its lane is closed, and the King stands until the match ends, so
  `troopShapeFor(side, openLanes(state, side))` is exact for any battle;
- the Digger's map (`digShape`): every dry tile and both bridges, minus
  `e.radius + DIG_CLEARANCE` around every alive `isBuilding` entity (both
  sides', towers included), as `canDigTo` rules.

Two numbers are copies of private sim constants: `KING_KEEP_CLEAR = 4.5`
(`KING_DEPLOY_BUFFER`) and `PRINCESS_KEEP_CLEAR = 3`
(`PRINCESS_DEPLOY_BUFFER`). They are the only copied rule numbers, and
`deployZone.grid.test.ts` pins the whole drawn shape to
`checkDeploy(...) !== "bad-spot"` (section 6). The princess circle never
decides anything with today's geometry (a standing princess is always in a
closed lane, and its circle stays inside that lane) but it is built in.

The verdict everywhere else (hover disc, pip, words) calls `checkDeploy`
itself: `placeVerdict` maps `ok` → yes, `no-elixir` → wait, `bad-spot` → no;
`badSpotReason` splits `bad-spot` into the six reasons with exported
helpers (`canDeployTroopAt`, `openLanes`, `inRiver`, `onBridge`) plus the
King distance.

## 3. Overlay architecture

`src/render3d/scene/deployOverlay.ts`, class `DeployOverlay`:

- ONE mesh named `deploy-overlay`: `PlaneGeometry(18, 32)` (2 triangles,
  1 draw call), a `ShaderMaterial`, transparent, depthWrite off, depthTest
  on, fog off, `renderOrder -0.5` (after decals -2, light pools and contact
  shadows -1; before team discs, the hover disc and ring, the ghost and
  every FX at >= 0). Fully transparent fragments are discarded.
- It replaces the 8 old meshes (`zonePlane`, `enemyDarkL/R`,
  `laneBlueL/R`, `enemyEdgeL/R`, `kingNoDeploy`) and their constants.
- The map is an **R8 signed-distance texture**, 144 x 256 (8 texels per
  tile, 37 KB, `DataTexture`, linear filter, no mipmaps, `flipY` false),
  clamped to +-2 tiles. Only distance is stored; water, halves, lanes and
  stripes are worked out in the shader, so no class code is ever blended by
  the linear filter.
- Height and parallax: the plane sits at y 0.15 (the river's bank lips top
  out at 0.13) and slides along the orthographic camera's ray by
  `0.15 * CAM_HOME.z / CAM_HOME.y = 0.13` tiles toward the viewer
  (`-0.13` for the guest), so every line is drawn over the ground point it
  describes. The vertex shader builds `vTile` from the LOCAL `position`
  attribute, so the mesh's shift moves the content (the design prototype
  used world coordinates, which made the shift a no-op and put lines about
  3 px toward the enemy on a phone).
- The four troop maps of a battle (lanes none / left / right / both for the
  viewer) are painted once on the first sync (about 2-3 ms each, during the
  countdown); a lane opening swaps the texture's data. The Digger's map is
  painted on demand, at most every 0.25 s while buildings change. The first
  render of a battle draws the plane once at alpha 0, so the program is
  compiled and the texture uploaded before any card is held.
- The mesh is a child of `Battle3D.scene`, not `arenaGroup`, so an arena
  look rebuild never disposes it. `Battle3D.dispose()` calls
  `zone.dispose()` (texture, material, geometry) before `disposeDeep`.
  `reset()` (new battle, context restore) forgets the battle, so the next
  sync seeds the open lanes quietly: no reveal for a lane that was already
  open.
- Reveal clocks run on presentation time (`scaledDt`), so a 4x replay still
  shows the reveal at reading speed.
- DOM: one reused `.place-pip` element (`hud.placePip`) and one
  `.lane-pill` per reveal (`hud.lanePill`), both `pointer-events: none`;
  their placement is pure (`pipPlacement`, `lanePillBox` in hudModel.ts).
  The pill is never wider than the pocket on screen minus 8 px; in a
  narrow pocket (landscape phones) the padlock sits on top so the words
  wrap to two lines inside the pocket.
- main.ts: `lastPointer` is kept on every pointer move; `refreshPreview()`
  runs once per frame after `scene.sync` (one `pick` + one `checkDeploy`)
  and on a canvas `pointerdown`; it is cleared when a finger or pen lifts,
  on window blur and after a refused drop. `updateLanePill()` shows the
  newest reveal's label unless replaying, in the tutorial, after the result
  or during the final-blow zoom. DEV builds warn once per battle when the
  board's viewpoint differs from the side you play (only the staged S8
  view and the `?viewpoint` aid do that). `__cr.check(card, x, y)` returns
  the sim's verdict for the local side.

## 4. Tuning

| Knob | Value | Where |
| --- | --- | --- |
| Outline core | max(0.16 tiles, 3 CSS px), alpha 0.96, inside the edge; x1.35 on call-back / refusal | deployOverlay.ts FRAG |
| Outline colour | #FFFFFF x 0.88 linear (Golden Age #FFF3D6 x 0.88), under the 0.92 bloom threshold | `LINE_*`, `LINE_GAIN` |
| Ink rim | #1F1A2E, max(0.06 tiles, 1.5 CSS px), alpha 0.85, outside the edge | FRAG |
| Lit pocket colour | team "main" mixed 45% to white (Golden Age #2BB7B0 mixed 25% to white) | `refreshLit` |
| Pocket fill | 0.20 x (1 - 0.6 x dayPhase) | `NIGHT_FILL_CUT` |
| Inner glow | 0.8 tiles; pocket 0.22, own half 0.16, both x (1 - 0.45 x dayPhase) | `NIGHT_GLOW_CUT` |
| Lit colour gain | 1 - 0.2 x dayPhase | `NIGHT_LIT_CUT` |
| NO base | ink #1F1A2E, alpha 0.58 → 0.44 at night | `render()` |
| NO stripes | ink alpha 0.67 over the base; 45 degrees in arena space; period max(0.75 tiles, 12 CSS px); 35% duty | FRAG |
| Dark-floor stripes | floor swatch sRGB luma < 0.36 (Golden Age: its plaster): white stripes at alpha 0.18; today only the Classic forge | `DARK_FLOOR_LUMA`, `floorSwatch`, `setLook` |
| River | half the NO base, no stripes | FRAG |
| Plane | y 0.15, ray shift +-0.13, renderOrder -0.5 | `LIFT`, `VIEW_SHIFT` |
| Reveal | 0.6 s still, then a 1.0 s smoothstep grow to 10.5 tiles; lit to 4.0 s; fade to 4.6 s | `REVEAL_*` |
| Reveal (reduced motion) | whole pocket fades in over 0.3 s from 0.6 s | `STILL_FADE_IN` |
| Lane opens under a held card | 0.25 s cross-fade | `HELD_OPEN_FADE` |
| Map in / out | 0.12 s | `HOLD_FADE` |
| Label | 1.0-4.0 s; pop 0.5 s; fade-out 0.25 s from 3.75 s | `CALLOUT_*`, hud.css |
| Outline call-back ease | 0.12 s | `CALLBACK_EASE` |
| Refusal | outline x1.35 for 0.8 s; white flash alpha 0.22, two beats over 0.6 s | `REFUSE_*`, `FLASH_ALPHA` |
| Welcome pulse | fill +0.16 sine bump over 0.7 s, once per lane per battle | `WELCOME`, `WELCOME_GAIN` |
| Ghost on a "no" spot | x0.4 opacity | `GHOST_DIM`, scene3d.ts |
| Pip | yes 26 px, no 34 px, wait 30 px; 62 px above a finger, 40 px above a mouse | `PIP_SIZE`, `PIP_LIFT_*` |
| Label box | pocket width on screen - 8 px; centre >= 24 px inside the field | `lanePillBox`, `LANE_PILL_INSET` |
| Narrow label | under 150 px wide: padlock on top | `LANE_PILL_NARROW`, hud.ts |
| Dig repaint | at most every 0.25 s | `DIG_REPAINT_MIN` |
| Refused ring / words | 1.2 s (unchanged) | `BAD_SPOT_SECONDS`, `DROP_HINT_MS` |

Deviations from the build spec, all from looking at the shots:

- `REVEAL_RADIUS` is 10.5, not 15. The farthest pocket point from its ruin
  is the river corner at the middle seam, 10.12 tiles away; with 15 the
  front left the pocket at 62% of the grow, so the sweep stopped dead after
  0.6 s and a shot 1.2 s after the fall showed a full pocket. A unit test
  pins the corner distance and that the front is still sweeping at 80%.
- `DARK_FLOOR_LUMA` is 0.36, not 0.30, and a Golden Age court is judged
  by its plaster. The look sheet showed the forge's ink stripes all but
  gone by night: its swatch (#5c5660) is 0.345, but its grade and lights
  render it near black. A test pins the result on the real looks: only the
  forge gets light stripes.
- Night calming is stronger than the spec's (fill cut 0.6 instead of 0.4,
  glow cut 0.45 instead of 0.3, plus a 0.2 cut of the lit colour), so the
  unlit pocket stays "lit ground" instead of turning milky at sky 1
  (section 8).

## 5. Strings (all through `tr(en, ar)`)

| Moment | EN | AR |
| --- | --- | --- |
| Lane opened (label) | Drop troops here now! | ضع جنودك هنا الآن! |
| Refused, no lane open: the enemy half or the river | Your side only! | في جهتك فقط! |
| Refused, the closed lane while another is open (`lane`) | Knock down this tower first! | أسقط هذا البرج أولًا! |
| Refused, the river while a lane is open; the Digger in the water (`river`) | Not in the water! | ليس في الماء! |
| Refused, inside the King's keep-clear (`king`) | Too close to the King! | قريب جدًا من الملك! |
| Refused, a princess's keep-clear (unreachable today) | Too close to a tower! | قريب جدًا من البرج! |
| Refused, the Digger on a tower or building body (`dig`) | Can't dig here! | لا يمكن الحفر هنا! |

The pip has no words. The verbs match the tutorial's ("Drop the Musketeer
here", "knock down a tower").

## 6. Tests

- `src/render3d/deployZone.grid.test.ts` (about 2 s): 24 named states
  (views player / enemy x lanes none / left / right / both x Knight,
  Cannon, Digger; a Cannon deployed on each side), 2 Mirror states (copying
  the Knight) and 6 seeded random battles (0-2 extra buildings, random
  lanes; Knight and Digger). Every exact `i/20` point of the arena
  (231,401 per state; `i/10` for the random ones): the analytic map
  (`zoneSd > 0`) equals `checkDeploy(...) !== "bad-spot"` except exactly on
  an edge (`|sd| < 1e-9`), and the PAINTED texture read back through
  `sampleField` (the GPU's bilinear rule) agrees wherever `|sd| >= 0.07`:
  0 mismatches in both. Also: 16 rays from the King bisected on
  `checkDeploy` to 1e-7 in both views (the sim's edge must be
  `KING_KEEP_CLEAR` within 1e-6), the guest's map is the host's turned 180
  degrees (analytic and byte for byte), and the four precomputed lane maps
  are byte-equal to the live ones.
  **Mutation check (done):** `KING_KEEP_CLEAR = 4.4` and `4.6` each fail
  22 of the 46 tests, every failure saying "sim King buffer changed: update
  KING_KEEP_CLEAR in src/render3d/deployZone.ts", the bisection pin
  included. To repeat: edit the constant, run
  `npx vitest run src/render3d/deployZone.grid.test.ts`, revert.
- `src/render3d/deployZone.test.ts`: `deploysAnywhere`, `zoneModeFor`, the
  8 troop keys, the dig key after a building dies, a paint under 30 ms, the
  ruin and label spots.
- `src/render3d/scene/deployOverlay.test.ts` (no GPU): the reveal timeline
  and the wave's sweep; no reveal on the first sync, a new state, a reset
  (the context-restore path), a finished match or the viewer's own fallen
  tower; the guest mirror; a lane opening under a held card (wave off,
  cross-fade, label, welcomed); picking up / putting down mid-reveal; the
  welcome pulse once; reduced motion; the label window and dismissal; the
  +-0.13 ray shift; the parallax (lifted lines project onto their ground
  points within 1e-6 for both cameras and KO-scaled frustums, and the
  vertex shader reads the local `position`); one mesh of 2 triangles;
  `dispose()` frees all three; light stripes on a dark floor; `sample()`.
- `src/render3d/hudModel.test.ts` "refused drops": every reason in both
  views (and the Digger's), all six texts, `placeVerdict`, `pipPlacement`
  and `lanePillBox`.
- `src/ui/icons.test.ts` (the four new glyphs), `src/ui/motionAttr.test.ts`,
  `src/render3d/dispose.test.ts` (the fake Battle3D gains `zone`).
- Unchanged and passing: `i18nLint`, `noEmoji`, `layoutCss`,
  `golden.test.ts`, `bot.test.ts`.

## 7. Reduced motion and colour-blind kids

`reducedMotion()` (ui/prefs: the in-game setting, or the OS on "auto"):

- the reveal does not grow: the whole pocket fades in over 0.3 s, holds,
  fades out; the label appears without its pop (its fade-out stays);
- no welcome pulse, no outline easing, the refusal flash is a steady
  highlight, the hover ring holds still (scale = disc, opacity 0.85), and
  `badSpotPulse` is one still ring that fades (both pulses ignored the
  setting before);
- a lane opening under a held card keeps its 0.25 s cross-fade (a fade,
  not motion);
- CSS: `ui/motionAttr.ts` puts `data-reduce-motion` on `<html>` at boot and
  on every prefs or OS change; hud.css repeats both
  `prefers-reduced-motion` blocks under `:root[data-reduce-motion]` and adds
  `.lane-pill`, `.place-pip` and `.error-shake`. That also fixes
  `.drop-hint`, which used to follow only the OS setting.

No meaning rides on hue alone:

| Meaning | Carriers |
| --- | --- |
| Yes | solid bright outline + lighter ground |
| No | stripes + darker ground (+ the outline edge) |
| King keep-clear | outlined arc + stripes |
| Verdict | tick vs no-entry sign vs hourglass (shapes and sizes differ) |
| Lane opened | the appearing outline + the padlock + words |
| Refusal | words + region flash + ring |

The lit pocket, the yes pip and the label follow the team palette (the
colour-blind palette's blue too), re-read on every pick-up and reveal.

## 8. Measurements

All from `/tmp/claude-0/place/measure.cjs` (mean sRGB and luminance L of
arena regions), a shot with a Knight held vs a control shot of the same
moment with no card (`stage.cjs --card none`), DPR 2, field rect
5,177,379,510. "Before" is the scout's DPR 1 measurement on eeaee3b.

| Region (L) | Before: held / control | After: held / control | Rule |
| --- | --- | --- | --- |
| Classic, open pocket | 172 / 171 | **186** / 171 (+15) | >= control + 10 |
| Classic, King keep-clear, open side | 174 / 177 | **106** / 176 | <= pocket - 25 |
| Classic, closed lane | 79 / 175 | **92** / 175 (0.53x) | 0.45x-0.70x control |
| Classic, own half | 163 / 163 | 162 / 162 | +-6 |
| Golden Age, open pocket | 175 / 173 | **184** / 172 (+12) | |
| Golden Age, King keep-clear, open side | 168 / 171 | **97** / 168 | <= pocket - 20 |
| Golden Age, closed lane | 77 / 173 | **89** / 172 (0.52x) | <= 0.70x |
| Guest view (S8), open pocket | (same as S1) | **185** / 171 | |
| Guest view (S8), King keep-clear, open side | | **96** / 159 | <= pocket - 25 |
| Classic night (sky 1), open pocket | 95 / 82 | **103** / 80 (+23) | <= control + 30 |
| Classic night, King keep-clear, open side | 107 / 82 | **58** / 80 | <= pocket - 20 |
| Classic night, closed lane | 26 / 84 | **45** / 83 (0.54x) | >= 30 and <= 0.75x |
| Golden Age night, open pocket | | **96** / 74 (+22) | <= control + 30 |
| Golden Age night, King keep-clear, open side | | **45** / 66 | <= pocket - 20 |
| Golden Age night, closed lane | | **39** / 72 (0.54x) | >= 30 and <= 0.75x |

The S8 numbers use the viewer-relative regions: `measure.cjs --view enemy`
used to flip them a second time and so measured the guest's own half as
its "pocket"; the helper is fixed (`measure.orig.cjs` kept).

Live agreement in the browser: `stage.cjs --probe` compares the drawn map
(`scene.zoneSample`, the texture the GPU reads) with `__cr.check` on a
0.25-tile grid wherever the drawn distance is at least 0.1 tile: S1, S2,
S3, S4, S7 9,242 points each, S6 9,204 and the Digger's dig map 9,111,
all with 0 mismatches. The real online guest's own map (below) also gave
0 of 9,242.

Outline call-back: the middle seam's bright core is 8 device px in S1 and
10 px in S2 (pointer on a "no" spot), DPR 2 on a phone.

Render cost (`node tools/perf-budget.mjs --matrix --url
http://127.0.0.1:3321`, "4 run(s) within every gate"; round-1 numbers in
brackets):

| View | Empty calls / tris | Fight calls / tris |
| --- | --- | --- |
| Classic phone 390x844@2 | 100 / 251,206 (102 / 251k) | 180 / 628,286 (180 / 628k) |
| Classic desktop 1440x900@1 | 106 / 276,298 (106 / 276k) | 184 / 653,374 (184 / 653k) |
| Golden Age phone | 107 / 259,444 (107 / 259k) | 199 / 661,740 (201 / 662k) |
| Golden Age desktop | 115 / 277,648 (115 / 278k) | 207 / 680,108 (205 / 680k) |

The gates never hold a card or fell a tower, so the map costs them
nothing. `--zone` (new, report only, never a gate) also reads the empty
battle with the map up for a held troop: Classic phone +1 call / +2
triangles; the other three views -1 call / -22 triangles, i.e. the plane's
1 draw / 2 triangles inside the empty frame's own frame-to-frame wobble.
That second run was also "within every gate" (fight 182-209 calls).

### Checked in the browser (dev server, SwiftShader, Playwright)

All under `/tmp/claude-0/place/build/final/`, DPR 2 unless noted; every
`stage.cjs` run reported ok and no page errors.

- **Real deploy into the opened pocket** (`tap/S1-tap-deploy.png`,
  `stage.cjs --scenario S1 --tap`: mouse down and up on the canvas at arena
  (4, 10)): a Knight entity now stands at exactly (4, 10) on the enemy
  half, the card left the hand, elixir 10 to 7, no words, no hand shake,
  and the map went away with the card.
- **Refused drop inside the King's keep-clear** (`tap/S2-tap-king*.png`,
  (8, 4)): "Too close to the King!" at the finger, nothing deployed,
  elixir unchanged, the hand did not shake; Golden Age: "قريب جدًا من الملك!".
  The other refusals: (13, 10) "Knock down this tower first!", (6, 16) "Not
  in the water!", the Digger on the standing right princess (14.5, 6.5)
  "Can't dig here!", all with no hand shake. (A Digger dropped on the
  fallen left princess's ruin at (3.5, 6.5) is allowed and went down: the
  ruin is not a body.)
- **The refusal flash** (`checks/flashpeak-sheet.png`): held at the top of
  its beat by pinning the overlay's own clock in the page, the King's bite,
  the closed lane and the river band each whiten over their not-allowed
  ground only. Per-frame trace of a real refused drop
  (`extra.cjs --check flash`): outline x1.35 while the pointer rests on the
  "no" spot and for 0.8 s after; flash 0.055 / 0.165 / 0 on the first three
  0.25 s SwiftShader frames (at 60 fps it is two clear beats).
- **Stale verdict fixed** (`checks/stale.json`): a still mouse on (4, 10) in
  the closed left lane with a Knight held: pip "no", red disc; on the first
  frame the tower is gone: pip "yes", green disc, with no pointer movement.
- **Context loss** (`checks/ctxloss.json`): `WEBGL_lose_context` lose, then
  restore, with the left lane long open: no reveal or label in the 9 frames
  after, and holding a Knight shows the right map (pocket +2, King -2,
  closed lane -2 tiles; pip yes).
- **Replay** (`checks/replay.json`, `checks/replay-reveal.png`): the tape's
  enemy left princess falls at sim 27.5 s; at 4x the pocket-only reveal
  plays (19 frames with a record, 16 drawn), with no label and no pip in
  any frame, and the hand cannot be armed. The tape was made with the
  worktree's own sim in main.ts's replay loop order
  (`/tmp/claude-0/place/replay/search.ts`: deploys, tick, bot tick), not
  recorded from a hand-played ladder match.
- **Look sheet** (`checks/looks-normal-sheet.png`,
  `checks/looks-arabic-sheet.png`, DPR 1): all 11 Classic and 11 Golden Age
  looks, day and night, a lane open and a Knight held: the outline never
  blooms and the stripes read everywhere except the Classic forge by night,
  which is why the forge now gets light stripes (`checks/forge-after.png`).
- **Real two-browser online match** (`checks/online-sheet.png`,
  `online.json`; `/tmp/claude-0/place/online.cjs`): a local relay
  (`vite-node server/relay.ts --relay-only` on port 3331) and two Chromium
  contexts on the worktree dev server; the host made a "Play a friend" room
  and the guest joined with its code. The guest played three cards with
  real hotkeys and mouse drops and felled the host's right princess at sim
  27.6 s. The guest got its own mirrored reveal (lane "right" by the sim's
  x split, top-left on its screen) and "Drop troops here now!"; the host,
  whose tower it was, got no reveal and no label. Holding a troop, the
  guest's pip was a tick in its pocket and a no-entry sign in the King's
  keep-clear and in the closed lane, and its whole drawn map agreed with
  its own `checkDeploy` (0 of 9,242). Both peers showed the same towers, no
  out-of-sync message and no placement warning.
- **Staged guest view** (S8): the map is S1's mirror; the DEV console says
  once "[placement] the board is drawn for 'enemy' but you play 'player'"
  (expected only in that staged view).
- **Reduced motion** (`extra/S5-still-1.2.png`, `extra/S1-still.png`,
  `extra/S2-still-tap.png`): the whole pocket at 1.2 s with no disc, the
  label without its pop, `<html data-reduce-motion>` set, the hover ring at
  the disc's scale with opacity 0.85 (checked on each run's frozen frame).
- **Colour-blind palette** (`extra/S2-cb.png`): the same outline, stripes
  and no-entry pip; the pocket and team colours turn the cb blue / orange.
- **Spell** (`extra/S1-fireball.png`): no map, no pip, the fireball's
  orange telegraph ring. **Wait** (`extra/S1-wait.png`, elixir held at 1):
  hourglass pip and a green disc.
- **Digger** (`extra/S1-digger.png`): no lit fill, outlined collars round
  the five standing towers, the water dimmed and outlined with both
  bridges inside.

## 9. Known gaps

- **Dev server and the fonts.** The worktree's `node_modules` is a symlink
  to the main checkout's, and Vite refuses to serve files from outside its
  root, so the first round of final shots came out in system fonts. The
  final shots were taken from a dev server started with
  `/tmp/claude-0/place/vite.wt.config.mjs` (the same dev settings plus
  `server.fs.allow` for that `node_modules`). Nothing in the repo changed.
- **SwiftShader timing.** Frames are 0.25 s of presentation time, so the
  staged reveal shots land a frame late (`--fall-delay 1.0` and `1.2` both
  shot at age 1.25), and an ordinary `--tap` shot catches the refusal flash
  at a low point of its beat; the flash was checked with a traced real drop
  and a pinned-clock shot instead.
- **The outline call-back is subtle**: x1.35 is 8 to 10 device px on a
  phone. It is the spec's number; the pip, the ghost fade and the words
  carry the "no" more loudly.
- **The landscape label is big for its pocket.** At 844x390 the pocket is
  about 118 px wide and the pill (padlock on top, two lines) covers most of
  it for 3 s; it never takes a tap and never leaves the pocket.
- **The plane is 0.15 tiles up**, so it tints the bottom 0.15 tiles of a
  troop's feet in the striped areas (not noticeable in the shots).
- **The touch pip lift** (62 px above a finger) is covered by unit tests
  only; every staged shot drives a mouse (40 px).
- **S8 is staged**: a solo battle with the guest's camera, so its HUD, hand
  and verdicts are the host's. The real online run above covers the real
  guest.
- **The replay check** used a tape made with the sim, not one recorded from
  a hand-played match (see above).
- **The princess keep-clear (3 tiles)** is drawn by the same code but never
  shows with today's tower layout.
