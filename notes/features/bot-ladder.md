# Bot ladder (C01): one even step at a time

Round 1 of `enhancement-plan-2026-11.md` ("Fair, kind and never stuck").
Branch `r1/bots`. Code: `src/match/difficulty.ts` (tiers, auto, solver),
`src/match/tierBanner.ts` (the banner), tests in `src/match/ladder.test.ts`,
`src/match/difficulty.test.ts`, `src/match/tierBanner.test.ts`,
`src/match/tapes.test.ts`, `src/game/novice.test.ts`,
`src/game/challenges.test.ts`. No sim change: `src/game` only has test
edits (novice, challenges); golden.test.ts and bot.test.ts are untouched;
SIM_VERSION and PROTOCOL_VERSION are unchanged.

## What was wrong

Practice and rookie had slip and reaction knobs; easy, normal and hard
had none. A near-random "kid" (pilot.ts: a random affordable card on a
random legal tile every 3-5 s) beat practice and rookie, then hit a wall:
0 wins in 200 games against easy. Bot against bot the order was upside
down at the top: old easy beat old normal, and old normal beat old hard
(hard pushed on 6 elixir and sent half-pushes). Auto climbed after one
+3 window and dropped after two losses, so an improving kid bounced
between a sleepy bot and a crushing one.

## The tiers, before and after

| Tier | Think every | Push at | Slips (mistakeRate) | Notices invaders after | spellIQ | Finisher |
|---|---|---|---|---|---|---|
| practice | 10 s | 10 | 0.6 | 2.5 s | 3 | no |
| rookie | 6.5 s | 10 | 0.45 | 1.8 s | 2.5 | no |
| easy, before | 1.8 s | 9 | 0 | at once | 1 | yes |
| **easy, now** | **5 s** | **10** | **0.35** | **1.5 s** | **2** | **no** |
| normal, before | 1.0 s | 8 | 0 | at once | 1 | yes |
| **normal, now** | **4 s** | **10** | **0.25** | **1 s** | **1.5** | **yes** |
| hard, before | 0.55 s | 6 | 0 | at once | 1 | yes |
| **hard, now** | **1 s** | **10** | **0** | **at once** | **1** | **yes** |

Practice and rookie are unchanged. Every knob now moves one way up the
ladder (difficulty.test.ts checks it): thinks more often, slips less,
notices sooner, spells smaller clusters, and finishes towers from normal
up. "Before" values for easy, normal and hard are the BOT_PROFILE_DEFAULTS
they ran with.

Why every tier pushes at 10: measured in a 10-profile round robin (no
slips, think 0.55-1.8 s, push at 6-10), banking a full bar is the
strongest play; push at 10 beat push at 9 about 2 to 1 and push at 8
about 3 to 1. Hard's think interval barely matters between 0.55 and
1.2 s once it pushes at 10, so it keeps the old normal's 1 s.

Ladder personalities: practice to normal now keep their own pace (they
were calibrated as a whole against the kid). Measured on the new tiers
(200 kid games each), the cycle tweak (think x0.85, push at 8) alone
turned easy's 0.355 kid win rate into 0.095 and normal's 0.15 into 0.04,
and siege (think x1.1) moved easy to 0.51 and normal to 0.21: one tier
would have spanned three.
Personalities still show in the decks they draft. Hard keeps the tweaks
for variety: cycle hard still beats normal 55-5, siege hard 59-1 (60
games, hard on the bottom half).

## Measured ladder, before and after

Harness: DEFAULT_DECK mirror, level 1 on both sides, 30 Hz headless sim.
Kid: 200 games per tier (bot seeds 300+i, kid seeds 9300+i). Duels: 100
per pair, 50 with the upper tier on each half of the arena.

Kid's win rate (target about 0.9 / 0.65 / 0.35 / 0.15 / under 0.05):

| | practice | rookie | easy | normal | hard |
|---|---|---|---|---|---|
| before | 0.96 | 0.645 | **0.00** | 0.015 | 0.015 |
| now | 0.96 | 0.645 | 0.355 | 0.15 | 0.00 |

Upper tier's share of duels against the tier below (the floor is 60%):

| | rookie > practice | easy > rookie | normal > easy | hard > normal |
|---|---|---|---|---|
| before | 98% | 100% | **29%** | **29%** |
| now | 98% | 81% | 85% | 96% |

The new hard against the old tiers (100 games each): beats old easy 71%,
old normal 80%, old hard 78%. "Hard" really is the hardest bot the game
has had.

What ladder.test.ts pins (fixed seeds, deterministic, about 15 s of
vitest time on this machine):

- duels, 24 seeds per pair, sides alternating: rookie > practice 0.917,
  easy > rookie 0.708, normal > easy 0.833, hard > normal 0.917 (floor 0.6);
- kid, 32 seeds per tier: 0.906 / 0.688 / 0.375 / 0.156 / 0.0, inside the
  bands [0.75, 1] / [0.5, 0.8] / [0.2, 0.5] / [0.05, 0.3] / under 0.05,
  each step at least 0.1;
- one duel replayed twice gives the same result.

novice.test.ts checks the same curve on its own 20 seeds (bot 100+i, kid
7000+i): 0.95 / 0.65 / 0.45 / 0.20 / 0.00, with bands practice >= 0.7
(also with the cycle speed-up), rookie >= 0.55, easy 0.2-0.55, normal
0.05-0.3, hard under 0.05.

Caveats: bots are not kids. The random pilot is a floor for a real
first-week kid, so real win rates will sit above these. The real ladder
also uses archetype decks, the kid's own deck and card levels (the bot is
the kid's deck average, -2 / -2 / -1 / 0 / +1 by tier, never below 1), and
main.ts's champion (after 3 wins) and mercy (picked tier, after 3 losses)
bands; none of that changed.

## The puzzle solver is frozen (SOLVER_PROFILE)

challenges.test.ts used to prove every puzzle clearable and check its
stars with `DIFFICULTIES.normal`. With the new normal the clears would
move (10 seeds each): the-horde 6 -> 0, bridge-spam 5 -> 0, air-raid
10 -> 1, mega-drop 7 -> 10, witch-party 7 -> 9, sky-pirates 4 -> 6,
giant-trouble 6 -> 7, and the test would fail. `SOLVER_PROFILE` in
difficulty.ts is a frozen copy of the old normal (`{ thinkInterval: 1.0,
pushAt: 8 }`, no optional knobs) that never follows tier tuning; the
challenges test solves with it, its expectations are unchanged, and every
puzzle clears exactly as before. Future puzzle work (C05 attack puzzles,
C06 trail) should rate with SOLVER_PROFILE too.

## Auto difficulty: two decisive windows to climb

- A window is the last 3 ladder results; it is decisive at +3 crowns or
  more (difference summed).
- Step up only after two decisive windows in a row: the last 3 results
  and the 3 before them both add up to +3 or more. The history now holds
  6 results (was 5). Back-to-back windows, not sliding ones: sliding
  windows would count one 3-crown win twice and climb on two wins and two
  losses (-1, +3, +1, -1).
- Step down as before: two straight losses at rookie or easy, or -3 over
  the last 3 at any tier. One win at practice returns to rookie. The first
  5 ladder matches never climb above rookie. A tier change starts a fresh
  history.

So a kid climbs after at least six good matches at a tier, and each new
tier is one even step harder.

## Telling the kid: the tier banner

After the solo ladder match that moved the bot a player on the auto
option meets, the result screen shows one framed row (above the coach
tip on a loss):

- up: "The bot is getting smarter!" / "الروبوت يزداد ذكاءً!" (a rising
  arrow, gold frame);
- down: "The bot will go easier next time" / "سيكون الروبوت أسهل في المرة القادمة"
  (a heart, green frame).

A picked tier never moves, so it never shows one; replays, sandbox and
online games don't count. It is a `registerResultExtra` slot installed by
`installAutoDifficulty()`, so main.ts is untouched. Checked in a browser
(dev build, SwiftShader): 390x844 phone Classic up and Golden Age down
(right to left), 1440x900 Golden Age up, 844x390 landscape Classic down.
On short landscape screens the result panel scrolls and, like the coach
tip, the group sits below Play again / OK.

## Replays

'Last battle' tapes store the bot's whole profile (`botProfile: banded` in
startLadder) and startReplay rebuilds the bot from the tape alone
(`{ ...BOT_PROFILE_DEFAULTS, ...rep.botProfile }`), never from the tier
tables, so tapes saved before this change play back unchanged.
tapes.test.ts pins the source of both and replays recorded matches
against the old easy, normal and hard to identical state checksums.

## Who notices what

- A new kid on auto: same rookie start; easy and normal are now
  reachable steps instead of a wall.
- A kid already on auto keeps the tier in their saved record, which now
  plays the new profile: easy and normal are gentler, hard is tougher.
  A profile from before auto existed still starts at normal
  (freshAutoState), now the gentler one.
- A player who picked easy or normal gets a gentler bot; one who picked
  hard gets a tougher one.

## Left for later

- main.ts's comment in startLadder still says only practice and rookie
  keep their own pace (the rule for this package was to touch main.ts
  only for the banner, and the banner needed no main.ts change). The
  accurate rule is `keepsOwnPace` in difficulty.ts.
- notes/features/bot-difficulty.md describes the original three tiers.
- A smarter hard (holding a counter, punishing a lone tank) would need new
  bot logic in src/game, which is locked; the knobs were enough to make
  hard the strongest bot here.
