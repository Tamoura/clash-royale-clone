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
- **Not changed (frozen files):** the far king at landscape sizes (fit.ts / layout.ts framing, compact-hand) and `?viewpoint=enemy` in bot battles (main.ts outside the gate). Both are listed under Known gaps with the exact change each needs.

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
- Cleanup: dev server on 3205 stopped by PID; the throwaway baseline worktree removed. Not pushed: the publish step belongs to the workflow's shipper (the computed task says not to push).

## Requests for the publish step

- Push `art/ship` (fast-forward of `claude/game-visuals-character-balance-w122wb`, 12 commits on top of `29f6451`).
- Frozen-file follow-ups for their owners (not art changes): wide-mode top margin for the far king (`WIDE_BOX` in `scene/fit.ts` and `ui/layout.ts`, compact-hand), and keeping `?viewpoint=enemy` across bot-battle starts in main.ts (DEV aid).

