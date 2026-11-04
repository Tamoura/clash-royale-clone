# sim-card-wave: the one sim release of the enhancement round

Wave-1 package. The full design notes are in
[card-wave-3.md](card-wave-3.md): every stat change, the new mechanics,
the lab tables (random decks, tower troops and abilities, pacing), and the
version-bump checklist. This file records what shipped, how it was checked,
and what is left open.

## What changed
- **Sim fixes**:
  - Death blasts settle to a fixed point (crowns and King kills are no
    longer lost).
  - Spawned units take the spawner's level and credit.
  - The bot accepts even spell trades (it Zaps a full Bats pack).
- **Rebalance**:
  - Mega Knight, Zap, Arrows, Royal Giant, Executioner, Firecracker, Cannon,
    Electro Wizard.
  - Tombstone releases 4 skeletons when it falls.
  - Duchess reload 0.6 s, Cannoneer 290 (then the pacing scaling).
  - Royal Restore heals towers 250.
- **Pacing**:
  - Overtime is 60 s, all at 3x elixir, and troop hits on crown towers land
    3x (`OVERTIME_TOWER_DAMAGE`; spells are not tripled). The banner reads
    "OVERTIME!" / "3x elixir" / "Troops hit towers 3x!".
  - Princess towers deal 100. Cannoneer is 242 and Duchess 58.
  - Baby Dragon 1050 to 980 HP, Skeleton Barrel burst 60 to 150. The Giant
    stays at 3600 (see Targets).
- **New cards** (epic for now): Stone Golem (with the Pebble Golem token),
  Digger and Comet.
  - Unlock arenas: Bone Pit, Barbarian Bowl and Legendary Peak.
  - The bot plays all three.
  - Placeholder colours, Golden Age names, rigs and card info lines are in
    place until wave 2 brings their art.
- **Versions**: `SIM_VERSION` 3 (new `src/game/version.ts`, asserted by the
  golden test), `PROTOCOL_VERSION` 3, replay tape v3. The relay now answers
  `update-required` to a `create`, `join` or `quick` without `v` (a client
  older than versioning). Golden and bot-snapshot
  fixtures were re-captured in one commit:
  `deliberate golden re-capture: sim v3 (…)`.
- **Tooling**:
  - `npm run lab` (`scripts/lab.ts`: random / slot / mirror / towers).
  - `scripts/balance.ts` uses `isDeckable` and skips duplicate decks.
  - `test.testTimeout` is 20 s.

## Files touched outside the package's ownsFiles
- `src/ui/banner.ts` is mine for the overtime text only. To fix the landscape
  clipping I also changed `draw()`: "\n" now splits a banner into a headline
  and smaller detail lines (`bannerLines()`). I split "Last minute — 2x
  elixir!" the same way, because it overflowed in landscape too. No other
  package edits this file in wave 1.
- New `src/ui/bannerLines.test.ts` tests `bannerLines()`. It is a new file,
  so it can't conflict.

Two render tests pinned values this release changes on purpose. Each got a
minimal edit, and I'm flagging them for the owners:
- `src/render3d/hudModel.test.ts` (battle-clarity): the overtime clock at
  200 s now shows 0:40, not 1:40 (`fmtTime(100)` became `fmtTime(40)`). When
  battle-clarity rebases, keep the 60 s value; its new tests already use
  `OVERTIME_DURATION`.
- `src/render3d/scene/views/animate.test.ts` (no wave-1 owner; card-wave-art
  in wave 2): the "1 s on-hit stun doesn't ice" case now builds its 1 s stun
  directly instead of reading the Electro Wizard's (now 0.5 s).

## How it was verified

### Unit tests and build
`npx tsc --noEmit`, `npx vitest run` and `npm run build` / `npm run build:all`
all pass: 107 files, 1253 tests.
- `cardwave.test.ts`: 31 tests across the new mechanics.
- `overtime.test.ts`: overtime's 3x on every troop damage path, with spells
  and troop-vs-troop hits unchanged.
- `pacing.test.ts`: 128 seeds (about 11 s).
- `bannerLines.test.ts`, plus new cases in `mechanics.test.ts`,
  `bottricks.test.ts`, `integration.test.ts`, `checksum.test.ts`,
  `cardinfo.test.ts` and `validate.test.ts`.
- `novice.test.ts` passes unedited with the current rookie profile.

### Headless checks (dev server :3703, Chromium, DPR 1, `?quality=low`)
Profile: `cr-clone-arena-theme`, `cr-clone-tutored=1`,
`cr-clone-trophies=3000`, `cr-clone-meta-v1=1`, and owned and deck lists
with the three cards. Sandbox at 390x844 for (a)-(d).
- **(a) Stone Golem split.** `__cr.spawn('player','stone-golem',9,20)`
  rendered (the Giant placeholder). After its hp was set to 0, the first poll
  (0.4 s of sim time in Classic, 0.3 s in Golden Age) held exactly 2
  `pebble-golem` entities. No page errors.
- **(b) Digger**, dragged from the hand to 1.5 tiles behind the enemy's left
  princess tower (3.5, 4), which the reviewers asked for instead of (9, 9):
  - `elixirSpent` went up by 3.
  - It stayed burrowed for about 3.3 s, untargeted (no tower or projectile
    aimed at it), then surfaced.
  - It hit the tower 56 a hit: 8 hits (2534 to 2086) against a Cannoneer
    tower in Classic, and 5 against a Dagger Duchess tower in Golden Age.
  - A node check of every tower troop is in card-wave-3.md: 280-448 tower
    damage next to a tower, against 0-112 mid-field.
- **(c) Comet** on the enemy's right princess tower: 2534 at +1.2 s, 2134
  (-400) at +2.1 s, in both editions.
- **(d) Golden Age**: (a)-(c) repeated with `cr-clone-arena-theme='arabic'`.
  No console errors (only SwiftShader's "GPU stall" warnings).
- **Banners** at 360x740, 390x844, 844x390 and 1280x800, in both editions.
  The clock was jumped to 120 s, then to 179.6 s. At full size, every text line
  of "Last minute!" and of "OVERTIME!" sits inside the field's screen columns
  (`__cr.fieldRect()`) and clear of `#hud`, including landscape, where the
  reviewers saw it clipped. There was no horizontal scroll and no console
  errors.

### Online (`npm run build:all`, `PORT=3704 node dist-server/relay.mjs`)
- Raw WebSocket handshakes:
  - `create`, `join` or `quick` with no `v` (the new-card deck included):
    `{"t":"error","reason":"update-required"}`.
  - `create` with `v: 2`: `update-required`.
  - `v: 3` with the new cards: `created`.
  - A deck holding `pebble-golem`: `bad-message`.
- **Friend game, two pages** (dev pages, 390x844, `?quality=low`, host plus an
  incognito guest; both decks hold Stone Golem, Digger and Comet):
  - Both sides had played all three by 39.5 s of match time: the host
    Digger, Comet, Stone Golem; the guest Comet, Digger, Stone Golem.
  - Both kept playing them until the finish at 152.9 s: guest VICTORY 3-1,
    host DEFEAT 1-3, the same result on both pages.
  - There was no desync, out-of-sync or no-contest screen. Both pages had
    empty console and page-error logs, and the relay logged no warnings or
    errors.
  - An earlier run of the same script reached overtime at 1-1. Both pages
    showed "OVERTIME! 3x elixir Troops hit towers 3x!", and the guest won
    3-1 at 187.3 s.

## Targets
All met (card-wave-3.md has every table):
- **Pacing** (DEFAULT_DECK mirror, 1024 seeds): 31.9% 0-0 and a 210.7 s
  mean, against 35% and 215 s. Sim v2 gave 50.8% and 260 s. Across random
  decks, 0-0 fell from 13.3% to 6.8% and tiebreaks from 14.4% to 7.8%. The
  first pass of this package missed the 0-0 target (54%). Its 20-seed test
  passed on a lucky window, as the reviewers found. Overtime's 3x troop hits
  on towers close the gap, and `pacing.test` now plays 128 seeds.
- **Cards** (two independent 6000-match random-deck runs): every deckable
  card is inside 38-63%. Pooled, the range is Giant 39.3% to P.E.K.K.A 61.1%.
  New cards: Comet 50.0%, Digger 46.8%, Stone Golem 44.1%.
- **Tower troops**: Duchess and Cannoneer both 47.4% against the Princess.
- **Restore** against no ability: 60.4% over 768 matches (63.0% on the
  192-match row, so I re-ran it larger).

Not done on purpose: a Giant buff. Buffs big enough to move it (4000-4400 HP)
made first-hour's rookie and practice bots beat a near-random pilot more
often. Practice with the cycle speed-up fell from 83/100 to 62/100 at 4400.
The Giant stays at 3600, inside the band.

## Known gaps / follow-ups
- **Merge risk for first-hour's `novice.test`.** Its "rookie at least 55%" case
  (20 seeds) gives 10/20 on this sim. The first pass gave 11/20, a pass by one
  game. Over 100 seeds the rate barely moved (57 to 56). A scratch merge of
  both branches confirms the failure (0.5 against 0.55). Per the plan, retune
  first-hour's knobs, never the sim. Rookie `thinkInterval` 6 to 6.5 gives
  13/20 (62/100) on this sim; card-wave-3.md has the other knobs tried.
- The current `novice.test` passes (rookie 8/20, hard 0/20). Over 100 seeds
  it is rookie 37/100 (first pass 39) and hard 2/100.
- `roomClient.ts` (online-truth) still sends no `v` on its no-loadout
  `create`/`join` branch. Nothing in the app takes that branch, and the relay
  would now answer `update-required`. online-truth or the integrator may
  stamp `v` there too.
- The Giant is near the bottom of the bot-vs-bot lab (39%). The next balance
  pass should look at how the bot plays it.
- The Digger needs a spot near a tower. Mid-field at (9, 9) it lands 0-2 hits,
  depending on the tower troop, and none against the Dagger Duchess. A kid
  hint such as "Drop it next to a tower" belongs in battle-clarity's or
  card-wave-art's blurbs.
- Placeholders until wave 2:
  - The Comet has no card art (an orange tile) and no landing effect beyond
    the generic burst.
  - The Golem, Pebble and Digger borrow other rigs.
  - The Digger's tunnel isn't drawn: the view is just hidden.
- online-truth's new test files must use `PROTOCOL_VERSION` rather than a
  literal `v: 2` after rebasing onto this branch.
