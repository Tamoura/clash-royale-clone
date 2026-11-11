# Art ship (wave 2): final integration of "Toy Tournament"

Package `ship` from `notes/features/art-direction-2026-11.md` (## Packages, ### ship). Branch `art/ship`, worktree `/home/user/wt-art-ship`, created from `claude/game-visuals-character-balance-w122wb` at `29f6451`. The four wave-1 packages (stage, cast-kit, creatures-fx, towers) were already merged there by their per-package shippers, so this package does not merge: it wires what is left, unifies the material constants, tunes, budgets, verifies and writes the owner's before/after.

Dev server: port 3205 (verifiers 3215). Shots: `/tmp/claude-0/art/ship/`. Drivers: `/tmp/claude-0/art/ship/tools/`.

## Decisions

(filled in as the work lands)

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
- Verification matrix running (`/tmp/claude-0/art/ship/tools/run-verify.sh`: jobs-std, jobs-looks, jobs-extra). Next: look at every image, prod smoke, Fast 3G fresh profile, guest view, owner sheets, notes.

