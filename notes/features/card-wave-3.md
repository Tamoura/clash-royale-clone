# Card wave 3: sim v3 (Stone Golem, Digger, Comet, fair and decisive battles)

One deliberate sim release, shipped under one golden re-capture and one
version bump (`SIM_VERSION` 3, `PROTOCOL_VERSION` 3, replay tape v3). It
fixes two sim bugs and a bot bug, rebalances the outliers the labs measured,
makes overtime short and decisive, and adds three cards. Package `sim-card-wave` of the
enhancement round (plan in `/tmp/claude-0/enh/plan.json`).

## What changed

### Bug fixes
- **Death blasts settle to a fixed point** (`sim.ts` `processDeaths`). Passes
  repeat until none finds a new casualty, so a Balloon or Golem blast that
  kills a crown tower earlier in the entity list now awards the crown, emits
  `death:princess-tower`, wakes the King, and a King killed this way ends the
  match. Before, 30 of 150 Balloon-vs-Balloon lab games lost a tower with no
  crown. Crowns now cap at 3.
- **Spawned units take the spawner's level** (`Entity.sourceCardId`). Witch,
  Tombstone and Skeleton Barrel skeletons, and death spawns, use the parent
  card's level and credit their damage to it. A level-5 Witch now makes
  112 HP skeletons, not 80.
- **The bot accepts even spell trades** (`bot.ts` `findCluster`:
  `value >= minValue - 1e-9`). It now Zaps a full Bats pack. Before, float
  rounding decided it.

### Rebalance (before → after)

| What | Before | After | Why |
|---|---|---|---|
| Mega Knight HP / damage / charge | 3400 / 240 / 2x after 3 tiles | 3000 / 200 / none | 66.8% across random decks; the jump is his charge |
| Zap damage | 250 | 210 | it beat Arrows and one-shot Archers |
| Arrows damage | 240 | 300 | now kills Archers and the Princess |
| Royal Giant HP / damage | 2400 / 200 | 3100 / 240 | 36.7%, the bottom of the table |
| Executioner HP | 700 | 1000 | 40.6% |
| Firecracker HP | 140 | 200 | 44.2% |
| Cannon damage | 130 | 160 | 40.2% |
| Electro Wizard stun on hit | 1 s | 0.5 s | stunned targets ~55% of the time |
| Tombstone | spawns every 6 s | also releases 4 skeletons when it falls (interval stays 6) | 40.0%; CR-accurate |
| Princess tower damage | 120 | 100 | pacing (see below) |
| Cannoneer damage | 330 | 242 (290 × 100/120) | beat the Princess 62% |
| Dagger Duchess damage / reload | 70 / 1.1 s | 58 (70 × 100/120) / 0.6 s | lost to the Princess 67-33 |
| Royal Restore tower heal | 500 | 250 | 66.7% against no ability |
| Baby Dragon HP | 1050 | 980 | 63.1% in a 6000-match sample, over the 63% band edge |
| Skeleton Barrel burst damage | 60 | 150 | 39-40%, near the 38% floor |
| Giant | 3600 HP | unchanged | 39%, but every buff made the rookie and practice bots harder for a beginner (see Novice bands) |
| Overtime | 120 s, 2x then 3x | 60 s, 3x elixir throughout, troop hits on crown towers 3x | 0-0 tiebreaks after five minutes |

**Decisive overtime** (`sim.ts` `OVERTIME_TOWER_DAMAGE = 3`): in overtime,
troop and building attacks (melee, projectiles, splash, pierce) and death
blasts hit crown towers three times as hard. It multiplies with the Digger's
35% (56 a hit becomes 168). Spells keep `TOWER_SPELL_DAMAGE_FACTOR` and are
not tripled, so the bot's spell-finisher arithmetic stays right and a Comet
still takes 400. Troops hit troops for their usual damage. Sudden death still
ends the match at the first crown. `src/game/overtime.test.ts` covers each
damage path.

The banners now have a headline and short detail lines, so they stay inside
the field in landscape (844x390), where the hand panel covers the right of
the screen:
- "OVERTIME!" / "3x elixir" / "Troops hit towers 3x!"
  (AR: "وقت إضافي!" / "إكسير ثلاثي" / "الجنود يضربون الأبراج ×٣");
- "Last minute!" / "2x elixir" (AR: "آخر دقيقة!" / "إكسير مضاعف"), which had
  the same overflow.
The Duchess blurb now says "then a steady reload", and the Restore blurb says 250.

### New cards (all `epic` for now; wave 2 adds the legendary tier and the art)

| Card | Cost | Stats | Mechanic | Unlock |
|---|---|---|---|---|
| Stone Golem `stone-golem` | 8 | 5000 HP, 260 dmg / 2.5 s, slow, targets buildings, 260 death blast | bursts into 2 Pebble Golems | Bone Pit (200) |
| Pebble Golem `pebble-golem` (token) | 0 | 950 HP, 55 dmg / 2.5 s, slow, targets buildings, 55 death blast | never in a deck | none |
| Digger `digger` | 3 | 1000 HP, 160 dmg / 1.2 s, fast, 35% damage to towers (56 a hit) | deploys anywhere, tunnels there | Barbarian Bowl (400) |
| Comet `comet` | 6 | 1000 damage (400 to crown towers), radius 2, knockback 1 | lands 1.8 s after the cast | Legendary Peak (3000) |

Sim mechanics:
- **Death spawns**: `UnitStats`/`Entity` `deathSpawnId` and `deathSpawnCount`.
  Units spawn at the death spot on the `spawnOffsets` table, clamped onto the
  field, at the parent's level and credited to the parent.
- **Tokens**: `token: true`, `TOKEN_IDS` and `isDeckable(id)` (not the
  champion, not a token). `DECK` excludes tokens. Online decks
  (`validate.ts playableCardIds`), drafts, the daily deck, the Crazy scramble
  and `scripts/balance.ts` all use `isDeckable`. The relay rejects a deck or
  a deploy naming `pebble-golem`.
- **Deploy anywhere and burrow**: `TroopCard.deployAnywhere`. `checkDeploy`
  accepts any arena spot that is not river water (bridges are fine) and keeps
  radius + 0.6 clear of every tower and building body. The lane and
  tower-buffer rules don't apply. A played Digger tunnels for
  `min(3.3, distance(own King, spot) / 8)` s (sqrt only). While
  `burrowTimer > 0` it only counts down. It is skipped by targeting (so towers
  ignore it), chain and splash, death blasts, `applySpell`, Tornado pull, Heal,
  Restore, Salvo, projectile and pierce hits, collisions, and the bot's threat
  scan. It surfaces with a render-only `emerge` event, then the usual 1 s
  pop-up runs. `spawnUnits` (challenge waves, tests, `__cr.spawn`) fields it
  unburrowed.
- **Tower damage factor**: `UnitStats`/`Entity`/`Projectile`
  `towerDamageFactor` (default 1) scales melee and projectile hits on crown
  towers.
- **Delayed spells**: `SpellCard.landDelay` and `BattleState.pendingSpells`
  (`createBattle` initialises it). The cast pushes the usual `spell` event
  (the renderer's telegraph). `tick` lands each pending spell through
  `applySpell` once its ttl runs out, then pushes a render-only `spell-land`
  event. Nothing lands after the match ends. `stateChecksum` mixes
  `pendingSpells.length`.

Bot:
- The Stone Golem targets buildings, so it leads pushes as a win condition.
  `isTankCard` treats it as a tank, so the bot feeds support into its lane
  (tested).
- `tryDigger`: when flush (`pushAt`), the bot tunnels the Digger to 1.2 tiles
  past the far edge of the opponent's weakest princess tower. It falls back to
  the other tower if that spot is blocked. `tryCycle` and `trySplit` leave the
  Digger alone.
- The Comet joins `trySpellCluster` (radius 2, at least 2 troops, value of at
  least cost × spellIQ). `tryFinisher` Comets a tower at 400 HP or less, and
  skips a tower that our own falling Comet will already finish.
- Every branch is inert without the card in hand.

Placeholders (real art and fx arrive in wave 2, `card-wave-art`):
- `CARD_COLOR` and `ARCHETYPES` entries.
- `ISLAMIC_NAME`: حارس الحجر, حصاة, حفّار الرمال, شهاب.
- Rigs borrowed from existing cards. Golem and Pebble use the Giant (the war
  elephant in the Golden Age edition). The Digger uses the Mini P.E.K.K.A
  (the Duelist).
- `views/troops.ts` hides a tunnelling troop.
- Card info lines: "Splits into 2 Pebble Golems", "Releases 4 Skeletons when
  it falls", "Digs to any spot", "35% damage to towers", "Lands after 1.8 s",
  each in EN and AR.
- The Comet's card has no painted art yet (an orange tile), and its landing
  has no special effect yet beyond the generic cast burst.

### Versions
- `src/game/version.ts`: `SIM_VERSION = 3`. `golden.test.ts` FIXTURE records
  `simVersion: 3` and asserts it equals `SIM_VERSION`, and that
  `PROTOCOL_VERSION` is 3.
- `net/protocol.ts`: `PROTOCOL_VERSION` 3. The net tests import it instead of
  hard-coding 2. v1, v2 and v4 clients all get `update-required`.
- `net/validate.ts`: a handshake (`create`, `join`, `quick`) must carry `v`.
  One without `v` comes from a v1 client, older than versioning, and now gets
  `update-required` too (before, a missing `v` counted as current, so such a
  client could enter a v3 match and desync). In-match messages (`frame`,
  `sync`, `ping`...) carry no `v`, as before. Every current client stamps its
  handshakes: `session.ts` always passes a loadout, and `roomClient.ts` sends
  `v` with one. `roomClient`'s no-loadout branch still sends no `v`; nothing
  in the app takes it, and the file belongs to online-truth this wave, so I
  left it (the integrator or online-truth may stamp it too).
- `main.ts`: the replay tape is `v: 3`, and `storedReplay` accepts only v3. A
  v2 tape no longer reproduces its match, so it is dropped.

## Version-bump checklist (for this and every future sim change)
1. Change the sim, then re-capture `golden.test.ts` FIXTURE and the
   `bot.test.ts` "bot snapshot" FIXTURE in ONE commit titled
   `deliberate golden re-capture: …` that lists the reasons.
2. Bump `SIM_VERSION` (`src/game/version.ts`) and the FIXTURE's `simVersion`.
3. Bump `PROTOCOL_VERSION` (`src/net/protocol.ts`). The golden test asserts
   the pair.
4. Bump the replay tape `v` in `main.ts` (`ReplayData` and `storedReplay`).
5. Deploy:
   - **Render** (one service, `npm run build:all && npm start`): the page and
     the relay ship together. Nothing else to do.
   - **GitHub Pages + Fly**: deploy the relay first
     (`docs/deploy-multiplayer.md`), then the page. In between, a cached v2
     page gets `update-required` and the lobby's Reload button. No v2 page can
     ever meet a v3 page in a match.
6. Any test file outside this package that hard-codes `v: 2`, or sends a
   `create`/`join`/`quick` with no `v` through `parseClientMsg`, must use
   `PROTOCOL_VERSION` after the merge (online-truth's new tests in particular).

## Lab method
`npm run lab -- <mode>` (`scripts/lab.ts`). Every game is Normal bot vs
Normal bot (`thinkInterval 1, pushAt 8`), one bot on each side, level 1, both
orientations per seed. TWEAKS overrides card, unit, tower-troop and ability
stats. Runs are deterministic per seed. For speed I bundled the script with
esbuild and split each random run over 3 processes.

- `random 3000`: 3000 random deck pairs x 2 orientations = 6000 matches.
  Decks are drawn from the deckable pool. A card counts only for the side
  whose deck holds it alone. The shipped numbers come from two independent
  6000-match runs (seed offsets 0-2 and 10-12), so 12000 matches and
  n = 3640-3908 per card.
- `towers tower <troop> 96` and `towers ability <id> 96 <vs>`: 192 matches
  each. Half use DEFAULT_DECK mirrors and half use random-deck mirrors.
- `mirror <n>`: the DEFAULT_DECK mirror, for pacing.
- Pacing also used a small harness (not committed) that runs the same
  Normal-vs-Normal match on a second seed scheme (70001 + 7919i) and on random
  deck pairs, and records per-seed outcomes.

Columns:
- "Before": this branch with the bug fixes and the new cards, but sim-v2
  stats and pacing (commit `2508db1`). It reproduces the analyst's a1ed21f
  numbers (mirror n=64: OT 82.8%, tiebreak 42.2%, any crown 57.8%, 3-crown
  0%). The analyst's a1ed21f random-deck run (2132 games) had Mega Knight at
  71.1%.
- "First v3 pass": the version the reviewers measured (one-minute 3x
  overtime, no tower-damage rule, Baby Dragon 1050, Skeleton Barrel 60).
- "Shipped": the final sim v3.

## Random decks: per-card win rate

Target: every deckable card 38-63%, the new cards 42-60%. **Met.** Pooled
over 12000 matches, the lowest card is Giant at 39.3% and the highest P.E.K.K.A
at 61.1%. Pooled standard error is about +/-0.8 points, and each 6000-match
run is about +/-1.1. In single runs the extremes are Giant 38.6% (offsets
0-2) and Skeleton Army 61.7% (offsets 0-2). Both are inside the band, but
within one single-run standard error of its edge. New cards (pooled): Comet
50.0%, Digger 46.8%, Stone Golem 44.1%.

Skeleton Army and Arrows swing about 4-7 points between the two runs, more
than the noise allows. Each run uses different deck pairs, so I read the
pooled column.

| Card | Before | First v3 pass | Shipped, offsets 0-2 | Shipped, offsets 10-12 | Shipped, pooled | n |
|---|---:|---:|---:|---:|---:|---:|
| pekka | 60.8% | 61.5% | 60.9% | 61.3% | 61.1% | 3908 |
| witch | 56.5% | 59.1% | 59.2% | 60.5% | 59.8% | 3794 |
| skeleton-army | 62.5% | 62.4% | 61.7% | 57.8% | 59.8% | 3734 |
| baby-dragon | 60.7% | 63.0% | 60.4% | 59.0% | 59.7% | 3826 |
| mini-pekka | 60.2% | 60.3% | 60.3% | 58.7% | 59.5% | 3808 |
| mega-knight | 66.8% | 58.3% | 58.2% | 59.0% | 58.6% | 3858 |
| zap | 59.4% | 58.1% | 58.2% | 57.6% | 57.9% | 3806 |
| valkyrie | 55.7% | 57.1% | 57.5% | 58.3% | 57.9% | 3780 |
| arrows | 51.8% | 52.6% | 53.1% | 60.2% | 56.7% | 3862 |
| electro-wizard | 63.1% | 55.0% | 55.9% | 54.9% | 55.4% | 3706 |
| ice-wizard | 53.6% | 56.2% | 57.2% | 53.6% | 55.4% | 3714 |
| fireball | 54.8% | 53.6% | 53.6% | 54.0% | 53.8% | 3716 |
| balloon | 54.1% | 54.3% | 54.7% | 52.5% | 53.6% | 3872 |
| knight | 51.9% | 52.7% | 51.5% | 55.5% | 53.5% | 3736 |
| wizard | 54.1% | 52.0% | 53.4% | 51.5% | 52.5% | 3740 |
| skeletons | 55.2% | 53.4% | 54.0% | 50.6% | 52.3% | 3800 |
| prince | 52.0% | 53.6% | 52.7% | 51.6% | 52.2% | 3816 |
| minions | 51.4% | 51.9% | 51.5% | 52.5% | 52.0% | 3736 |
| bats | 51.0% | 51.6% | 50.9% | 52.4% | 51.6% | 3868 |
| magic-archer | 48.6% | 49.1% | 49.1% | 51.5% | 50.3% | 3882 |
| musketeer | 50.6% | 51.6% | 51.8% | 48.7% | 50.2% | 3742 |
| **comet** | 52.2% | 50.5% | 51.3% | 48.6% | 50.0% | 3730 |
| archers | 49.7% | 51.5% | 50.5% | 48.1% | 49.3% | 3726 |
| tombstone | 40.0% | 49.0% | 49.8% | 48.8% | 49.3% | 3722 |
| gargoyles | 47.2% | 47.5% | 46.9% | 49.5% | 48.2% | 3730 |
| **digger** | 46.5% | 47.6% | 46.7% | 46.9% | 46.8% | 3640 |
| rage | 46.0% | 45.3% | 45.9% | 46.5% | 46.2% | 3660 |
| heal | 46.1% | 46.7% | 45.6% | 46.5% | 46.1% | 3822 |
| firecracker | 44.2% | 44.8% | 45.9% | 43.9% | 44.8% | 3798 |
| **stone-golem** | 44.0% | 43.3% | 44.7% | 43.5% | 44.1% | 3740 |
| executioner | 40.6% | 44.0% | 43.6% | 44.4% | 44.0% | 3802 |
| tornado | 42.9% | 41.7% | 41.7% | 44.2% | 42.9% | 3730 |
| freeze | 43.7% | 42.3% | 41.9% | 43.1% | 42.6% | 3696 |
| elixir-collector | 43.7% | 41.2% | 42.5% | 42.5% | 42.5% | 3758 |
| royal-giant | 36.7% | 42.6% | 41.9% | 42.7% | 42.3% | 3664 |
| cannon | 40.2% | 42.4% | 41.2% | 42.9% | 42.1% | 3716 |
| mirror | 42.9% | 42.1% | 42.5% | 41.3% | 41.9% | 3726 |
| skeleton-barrel | 41.1% | 39.1% | 40.8% | 41.6% | 41.2% | 3814 |
| hog-rider | 42.4% | 40.8% | 40.5% | 41.0% | 40.8% | 3808 |
| princess | 43.4% | 40.8% | 40.9% | 40.1% | 40.5% | 3826 |
| giant | 40.1% | 38.6% | 38.6% | 40.1% | 39.3% | 3872 |

Tombstone is at 49.3% with its death spawn, well above 42%, so its spawn
interval stays 6 s (the spec's fallback to 5 s was not needed).

**Why the Giant stays at 3600 HP.** A reviewer's 4200-match sample had the
Giant at 38.0%, so I tried buffs in a forced-card lab: random decks that hold
the Giant against random decks without it, 1600-2000 matches per variant.

| Giant | Win rate (seed set 1) | Win rate (seed set 2) |
|---|---:|---:|
| 3600 HP (shipped) | 40.3% | 38.0% |
| 3800 HP | 39.7% | |
| 4000 HP | 42.2% | 39.7% |
| 255 damage | 40.1% | |
| 300 damage | 41.4% | |
| 4000 HP, 270 damage | 43.0% | |
| 4400 HP | 44.7% | 41.9% |

Only a big buff (4400 HP) clearly moved it, and it went into a full
12000-match lab at 42.3% pooled. But the Giant is the starter deck's win
condition, and the bots use it far better than a beginner does. With 4400 HP
a near-random pilot (the novice proxy) won 48/100 against first-hour's rookie
profile (56/100 at 3600) and 62/100 against practice with the cycle speed-up
(83/100 at 3600). 4000 HP landed in between (53 and 70). A kid-facing bot
getting harder matters more than one bot-vs-bot number, so the Giant ships
unchanged. It sits inside the band, 1.6 pooled standard errors above the
floor. The next balance pass should look at how the bot plays the Giant
rather than at its stats.

**Independent check (round-1 review, 8400 more matches).** The reviewer ran
`npm run lab -- random 700` at offsets 41-43 and 61-63 on the shipped sim
(4200 matches each):

| Card | Offsets 41-43 | Offsets 61-63 |
|---|---:|---:|
| mini-pekka | 62.6% (n=1366) | 62.6% (n=1322) |
| baby-dragon | 59.5% | 59.3% |
| royal-giant | 37.6% | 41.5% |
| giant | 38.4% | 40.1% |

Pooled with the 12000 matches above (about 20000), Mini P.E.K.K.A is about
60.8% and Royal Giant about 39.6%, so the band is met; which edge a card
touches depends on the seeds sampled. First candidates for the next balance
pass: Mini P.E.K.K.A at the top, Giant and Royal Giant at the bottom. No sim
change was made for this (it would force another golden re-capture).

## Tower troops and King's abilities (192 matches each)

Targets: Duchess and Cannoneer vs Princess 42-58%, Restore vs no ability 62%
or less. **Met.** Restore read 63.0% on the usual 192 matches, so I re-ran it
on 768: 60.4% (+/-1.8).

| Matchup | Before | First v3 pass | Shipped |
|---|---:|---:|---:|
| Dagger Duchess vs Princess | 33.1% | 52.3% | 47.4% |
| Cannoneer vs Princess | 62.0% | 49.2% | 47.4% |
| Royal Restore vs no ability | 66.7% | 57.3% | 63.0% (768 matches: 60.4%) |
| King's Salvo vs no ability | 52.9% | 51.6% | 53.6% |
| Royal Rally vs no ability | 52.6% | 54.2% | 55.2% |
| Restore vs Salvo | 66.4% | 57.3% | 59.4% |
| Rally vs Restore | 32.8% | 43.2% | 46.4% |
| Rally vs Salvo | 49.5% | 53.9% | 51.8% |

Standard error is about +/-3.6 points per 192-match row.

## Pacing (Normal vs Normal, level 1)

Targets: 0-0 finishes 35% or fewer and a mean length of 215 s or less on the
DEFAULT_DECK mirror. **Met:** 31.9% 0-0 and 210.7 s over 1024 seeds.

"0-0" means the match ended with no crowns: a tower-HP tiebreak or a draw.
"Tiebreak" means decided on tower HP with crowns level (1-1 counts).

DEFAULT_DECK mirror. "A" is the lab's seeds (1000 + 17i) and "B" is an
independent scheme (70001 + 7919i). 512 seeds each.

| Configuration | 0-0 (A / B) | Tiebreak (A / B) | Mean length (A / B) | Overtime (A / B) | 3 crowns |
|---|---|---|---|---|---:|
| Sim v2 (a1ed21f) | 47.7% / 53.9% | 48.6% / 54.9% | 258.1 / 262.2 s | 82.6% / 83.0% | 0% |
| First v3 pass (60 s 3x overtime only) | 53.5% / 53.1% | 55.5% / 54.7% | 219.7 / 218.4 s | 75.8% / 71.1% | 0% |
| **Shipped (plus 3x troop hits on towers in overtime)** | **31.8% / 32.0%** | **33.0% / 32.8%** | **211.1 / 210.2 s** | 75.0% / 70.1% | 0% |

Random deck pairs (1000 matches, seeds 5000 + 13i, decks from the deckable
pool). The "same decks" row leaves the three new cards out of the pool, so
its matchups are identical to sim v2's.

| Configuration | 0-0 | Tiebreak | Mean length | Overtime | 3 crowns |
|---|---:|---:|---:|---:|---:|
| Sim v2 (a1ed21f) | 13.3% | 14.4% | 212.7 s | 46.2% | 4.5% |
| Shipped, same decks as v2 | 7.8% | 10.3% | 192.7 s | 44.1% | 5.7% |
| Shipped, new cards in the pool | 6.8% | 7.8% | 191.0 s | 40.7% | 5.5% |

So 0-0 finishes and tiebreaks fall by about a third on the mirror and by
about half across random decks, and matches are 20-50 s shorter. No match
runs past 4 minutes.

How I got there. Each row is one rule change on top of the first v3 pass,
with the mirror A and B at 512 seeds each and 600 random deck pairs:

| Variant | 0-0 (A / B) | Mean (A / B) | Random 0-0 |
|---|---|---|---:|
| First v3 pass | 53.5% / 53.1% | 219.7 / 218.4 s | 18.0% (1000) |
| 90 s overtime, 3x | 44.7% / 45.7% | 235.1 / 234.1 s | 11.2% |
| Princess tower HP 2534 to 2200 | 45.7% / 43.2% | 216.7 / 213.5 s | 11.7% |
| Overtime tower hits 2x (troops) | 38.1% / 41.4% | 214.2 / 214.4 s | 9.7% |
| Overtime tower hits 2x (troops and spells) | 36.9% / 40.0% | 213.7 / 214.1 s | 8.3% |
| Overtime tower hits 2x, 90 s overtime | 27.7% / 28.1% | 224.3 / 225.4 s | 4.7% |
| Overtime tower hits 2.5x (troops and spells) | 34.0% / 35.7% | 211.9 / 212.3 s | 5.8% |
| **Overtime tower hits 3x (troops and death blasts)** | **31.4% / 32.8%** | **210.8 / 211.5 s** | **4.8%** |
| Overtime tower hits 3x (troops and spells) | 29.7% / 31.6% | 210.3 / 211.0 s | 4.3% |
| Princess towers lose 12 HP/s in overtime | 32.8% / 32.8% | 214.3 / 212.7 s | 6.3% |
| Princess towers lose 20 HP/s in overtime | 16.2% / 17.8% | 209.5 / 208.3 s | 3.2% |

Longer overtime trades length for crowns, so it cannot meet both targets.
Tower bleed meets them, but it only shows the HP tiebreak earlier as a
falling tower, and it drips damage numbers onto every tower. Tripling troop
hits in overtime meets both targets by rewarding the push that lands. It is
one rule a kid can read off the banner ("3x elixir, troops hit towers 3x"),
and it mirrors the 3x elixir. Spells stay out of it: including them gained
only 1-2 points, and it would have made a Comet 1200 on a tower. The
princess-damage fallback in the spec (100 down to 90) reached only 48.4% 0-0
in the first pass, so princess damage stays at 100.

The shipped config was then re-measured with the final Baby Dragon and
Skeleton Barrel numbers (the shipped row of the first table).

`pacing.test.ts` now plays the first 128 lab seeds, not 20. There the build
gives 37 0-0 finishes (28.9%), 39 tiebreaks and 210.5 s. That is close to the
1024-seed population (31.9%, 210.7 s), so the sample is representative. The
eight 128-seed windows range from 26.6% to 39.1%. The test asserts 0-0 at or
under 35%, a mean at or under 215 s, fewer tiebreaks than sim v2 on the same
seeds (60, measured at a1ed21f), and that every match ends by 240 s. It
takes about 11 s. It guards against a regression; the 1024-seed lab above is
the measurement.

The old 20-seed test passed on a lucky window (20% 0-0 against 54% over 256
seeds), as the reviewers found.

## Novice bands

`novice.test.ts` is unedited and passes with the current rookie profile:
- rookie: 8/20, inside 35-65%;
- hard: 0/20, under 15%.

Over 100 seeds the near-random pilot wins:
- rookie 37/100 (first v3 pass: 39/100);
- hard 2/100.

First-hour's new tiers (their profiles from `wt-first-hour`
`src/match/difficulty.ts`, probed against this sim, 100 seeds):

| Tier | First v3 pass, 100 seeds | Shipped, 100 seeds | Shipped, their test's 20 seeds | Their test needs |
|---|---:|---:|---:|---:|
| practice | 98 | 95 | 19/20 | 14/20 |
| practice with the cycle speed-up | 83 | 83 | 16/20 | 14/20 |
| rookie | 57 | 56 | **10/20** | **11/20** |
| hard | 0 | 2 | 0/20 | under 3/20 |

**Merge risk for first-hour's `novice.test`:** its rookie case ("at least 55%"
on 20 seeds) gives 10/20 on this sim. The first pass gave exactly 11/20, so it
passed by one game. Over 100 seeds the rookie rate barely moved (57 to 56,
standard error about 5), so this is one game in a 20-seed window, not a
harder rookie. The plan's rule applies: retune first-hour's knobs (or test on
more seeds), never the sim. A scratch merge of the two branches confirms the
failure (0.5 against 0.55), and the challenge solvability test passes there.
Rookie knob probes on this sim (first 20 seeds / 100 seeds):
- as is: 10/20, 56/100;
- `mistakeRate` 0.5: 10/20, 56/100;
- `reactionDelay` 2.2: 10/20, 56/100;
- `thinkInterval` 6.5: 13/20, 62/100;
- `thinkInterval` 7: 17/20, 71/100.

`thinkInterval` 6.5 is the smallest step that passes, and practice (8.5 s
with the cycle speed-up) stays slower.

After the round-1 merge (`wip/round1`) first-hour's rookie ships at
`thinkInterval` 6.5: 13/20 on the test seeds and 0.64 pooled over 300 other
seeds (see first-hour.md). Every challenge clears 10/10 for the normal bot.

## How to verify
- `npx tsc --noEmit`, `npx vitest run` (20 s timeout from vite.config),
  `npm run build`.
- `src/game/cardwave.test.ts` covers:
  - Golem: the split count, level and credit, a crown from a Golem blast,
    edge clamping.
  - Tombstone: its death spawn, including at expiry.
  - Tokens: rejected by validate, never offered by draft or daily.
  - Digger: valid on the enemy half, rejected in the river and on bodies,
    burrow time, untargetable by towers, immune to Arrows and shoves while
    burrowed, emerges after `burrowTotal` + 1 s, 56 a hit on towers.
  - Comet: lands at 1.8 s and not before, knockback and dodging, level
    scaling, nothing after the result.
  - Bot: Golem push and tank support, Digger placement, Comet clusters and
    finisher, inert without the cards, and a seeded bot match that plays all
    three on both sides.
- `src/game/overtime.test.ts`: overtime's 3x on melee, projectiles, the
  Digger, death blasts; spells and troop-vs-troop unchanged; overtime starts
  at the regulation buzzer.
- `mechanics.test.ts`: Balloon blasts finish a 100 HP princess tower (crown,
  death event, King wakes) and a 50 HP King (result, 3 crowns), plus the
  level-5 Witch and Barrel skeletons. `bottricks.test.ts`: the bot Zaps a full
  Bats pack. `integration.test.ts` runs its invariants with the new cards on
  both sides. `pacing.test.ts` is described above. `validate.test.ts`: a
  handshake without `v` gets `update-required`.
- Lab: `npm run lab -- random 300`, `npm run lab -- mirror 128`,
  `npm run lab -- towers tower duchess 48`, and
  `npm run lab -- towers ability restore 48 none`.
- Headless (dev server, 390x844, `?quality=low`, Sandbox, profile with the
  three cards; `notes/features/sim-card-wave.md` has the results). For the
  Digger check (b), drop it next to a tower, about 1.5 tiles behind it: there
  it lands 5-8 hits whatever the tower troop. Mid-field at (9, 9) it lands one
  hit against the Princess, two against the Cannoneer and none against the
  Dagger Duchess, whose daggers kill it on the walk.

| Digger spot | vs Princess | vs Cannoneer | vs Dagger Duchess |
|---|---:|---:|---:|
| (9, 9), mid-field | 56 | 112 | 0 |
| 2.3 tiles in front of the tower (3.5, 9.2) | 336 | 448 | 280 |
| 1.5 tiles behind the tower (3.5, 4) | 336 | 448 | 280 |
