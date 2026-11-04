# Feature: first-hour (a kind first hour)

Wave 1 package `first-hour` of the enhancement round. Branch
`wip/first-hour`, based on a1ed21f. No sim change: `golden.test.ts`
and `bot.test.ts` are untouched and pass.

For kids: they finish the tutorial without the KING/Skip trap, win most
of their first matches, never drop out of an arena they reached, get a
specific hint after a loss, and join a sibling's game from a link on
their very first visit.

## What changed

### 1. Tutorial overlay (`src/ui/tutorialOverlay.ts`, `styles/tutorial.css`)
- The bottom-docked coach bubble ends above the highest HUD control
  that shares its columns: `#hud`, KING (`.hud-ability`), Next
  (`.hud-next`) and the emote bubble. The pure helper `controlsTop()`
  (tested) skips hidden controls and controls beside the bubble, so the
  wide layout's side panels do not push the bubble up.
- 'Skip tutorial' sits in the bubble's top row, next to the step dots,
  on one line. Its 44 px tap area reaches up toward the field, never
  down toward the HUD.
- After a step advances under a finger (a tap on KING, a callout tap),
  the overlay ignores taps and clicks for 350 ms, and for 350 ms after
  that finger lifts.
- The skip dialog uses `confirm({ emphasis: 'cancel' })`: 'Keep learning'
  is the yellow CTA and takes the focus. Esc or a backdrop tap mean keep
  learning. The dialog is mirrored (`dir=rtl`) in the Golden Age edition.
- The KING lesson's anchor now counts `position: fixed` HUD controls as
  visible (it used `offsetParent`), so in the wide layout the KING step
  gets its mask and pointing glove too.

### 2. `confirm()` emphasis (`src/ui/components.ts`, `components.css`)
- New optional `emphasis: 'ok' | 'cancel'`. The pure `confirmLook()`
  (tested in `components.test.ts`) gives each button's variant and the
  first focus. Without `emphasis` every existing dialog looks as before.
- `components.css` also styles the coach tip box (`.ui-coach-tip`).

### 3. Invites survive the tutorial
- The edition picker shows a bilingual 'Joining CODE…' chip when the
  URL has a valid `?join=` (`editionGate.ts`, pure `joinCodeIn()` tested).
- `startTutorial()` with a `?join=` first opens Home (so the boot arena
  holds still) and a sheet: 'Your friend is waiting!' with **Join now**
  and **Learn first** (EN and AR).
  - Join now: the lesson is not marked done (it runs on the next visit);
    Home, then `handleJoinLink(ctx)` (read-only import from
    `match/online.ts`).
  - Learn first, or dismissing the sheet: the tutorial runs. Finishing
    or skipping it ends in `handleJoinLink(ctx)` while `?join=` is
    still in the URL. 'Try again' after a lost lesson does not ask again.

### 4. Easier first battles (`src/match/difficulty.ts`)
| tier | thinkInterval | pushAt | mistakeRate | reactionDelay | spellIQ | finisher | card levels |
|---|---|---|---|---|---|---|---|
| practice (new) | 8 | 10 | 0.6 | 2.5 | 3 | no | deck avg - 2 |
| rookie | 6 (was 5) | 10 | 0.45 (0.35) | 1.8 (1.2) | 2.5 (2.0) | no | deck avg - 2 |

- `TIERS` is now `practice, rookie, easy, normal, hard`; DIFF_AR
  'تمرين', blurb 'A sleepy sparring partner'. Battle setup lists Practice.
- Auto: two straight ladder losses at rookie or easy drop one tier at
  once, even inside the first five (rookie) matches. A win at practice
  returns to rookie. Otherwise the 3-match crown window applies. Samples
  now record the outcome, so a 0-0 tiebreak defeat counts as a loss
  (older saves fall back to the crown difference).
- novice.test (20 seeds, random pilot vs bot): rookie 0.70 (band
  >= 0.55), practice 1.00 (>= 0.70), hard 0.10 (< 0.15). Over 80 other
  seeds rookie wins about 0.53 and practice about 0.96, so the 20-seed
  rookie result has some luck in it. Against the in-progress
  sim-card-wave tree the same seeds gave rookie 0.75, practice 0.85,
  hard 0.00.

### 5. Trophy floors (`src/meta/economy.ts`, `progress.ts`)
- `trophyLossAt(trophies)`: 0 below 100 (Training Camp); otherwise
  `min(20, trophies - arenaForTrophies(trophies).trophies)`. 50 stays 50,
  110 goes to 100, 130 goes to 110. `applyMatchResult` uses it (and never
  reports -0).
- Declared main.ts edit: the `leaveCost` expression calls
  `trophyLossAt(meta.profile.trophies)`, so the Forfeit dialog names the
  real cost. Its import line had to change with it (`MATCH_TROPHIES` →
  `trophyLossAt`), or `noUnusedLocals` fails.

### 6. Defeat coaching (`src/match/coachTips.ts`, new)
- After a lost solo ladder match the result screen shows one 'Coach tip'
  (registerResultExtra), first match wins:
  1. elixir leaked >= 4: "Don't let elixir sit at 10, play a card!";
  2. a tower of mine fell with a building-targeter on it (standing next
     to it, or seen hitting that spot): "Put Musketeer or Archers behind
     your Knight!" (names come from the deck in the current edition;
     a generic line if the deck has no front troop or shooter);
  3. no spell cast and the deck has Arrows, Zap or Fireball:
     "Arrows clears groups of little troops";
  4. otherwise one of four basics, rotating (`cr-clone-coach-rotation`).
- Installed from `installAutoDifficulty()`, so main.ts needs no change.
  The chooser and the watch are pure and tested.

### 7. Challenges (`src/game/challenges.ts`, screen `ui/screens/challenges.ts`)
Twelve survive puzzles, troop waves only, every blurb ends with the goal:

| # | id | stars | survive | gold |
|---|---|---|---|---|
| 1 | first-defense | 1 | 0:30 | 30 |
| 2 | little-ones | 1 | 0:30 | 30 |
| 3 | tank-stop | 1 | 0:35 | 40 |
| 4 | giant-trouble | 3 | 0:45 | 70 |
| 5 | air-raid | 2 | 0:45 | 50 |
| 6 | the-horde | 3 | 0:50 | 70 |
| 7 | hog-rush | 2 | 0:40 | 50 |
| 8 | sky-pirates | 2 | 0:45 | 50 |
| 9 | mega-drop | 2 | 0:40 | 60 |
| 10 | bridge-spam | 3 | 0:45 | 80 |
| 11 | witch-party | 2 | 0:45 | 60 |
| 12 | skeleton-storm | 2 | 0:40 | 60 |

- New optional `Challenge.stars` (unset reads as 2: wave-2 trials can
  leave it out). `sortedByStars()` is stable, so the three starters lead.
- The screen sorts by stars and shows per row: name + stars, a goal chip
  (shield + 'Survive 0:45' / 'اصمد ٠:٤٥'), a 'Cleared' chip, the blurb.
- Stars were set from a sloppy-bot proxy (the old rookie profile playing
  the challenge deck, 20 seeds): starters 20/20; Giant Trouble 0-8/20,
  The Horde 2-9/20, Bridge Spam 4-5/20 (three stars); the rest 16-20/20.
- challenges.test solvability: a normal bot on the player's side clears
  every one-star starter in >= 8/10 seeds and every challenge in >= 2/10.
  Today all are 10/10 except Giant Trouble (4/10 on this base, 10/10 on
  the sim-card-wave tree).

### 8. Home and Battle setup
- After a chest was earned this session (`cr-clone-pulse-chest`, set by
  the tutorial win) the tutorial's own glove bobs over the first chest
  slot, and the free chest's glow is muted, until the kid taps a chest
  once (`cr-clone-chest-tapped`). Pure `chestGuideSlot()` is tested.
- Lock pills in Battle setup and on Home's event tiles name the arena and
  its trophies ('Goblin Stadium · 100' with lock and trophy icons, AR
  arena names in the Golden Age), stacked on two lines inside narrow
  options. The difficulty picker wraps to two rows of three on phones.

## New test files
`coachTips.test.ts`, `ui/tutorialOverlay.test.ts`,
`ui/screens/editionGate.test.ts`, `ui/screens/battleSetup.test.ts` and
`ui/screens/home.test.ts` hold the tests for the pure helpers of owned
modules (the plan lists only the first; the others are new files only
this package touches).

## How to verify
1. `npx tsc --noEmit`, `npx vitest run --testTimeout=30000`, `npm run build`.
2. Tutorial: fresh profile with only `cr-clone-arena-theme=normal`, dev
   server, `?quality=low`, 390x844 then 360x740. At 'Their King woke up!',
   `document.elementFromPoint` at KING's centre and at 25% / 75% insets
   returns KING or a child. Tap KING: the step advances to 'Finish it'
   and no dialog is open 1 s later. 'Skip tutorial' opens a dialog whose
   yellow button is 'Keep learning'. Repeat at 844x390, 1280x800 and with
   theme `arabic`.
3. Invite: `npm run build:all`, `PORT=… node dist-server/relay.mjs`. Host:
   Battle setup → Play online → Play a friend → Create a game. Fresh
   profile opens `/?join=CODE`: the picker shows 'Joining CODE…'; after
   Continue, 'Your friend is waiting!'. Join now starts the match on both
   pages. With Learn first, skipping the lesson lands in the lobby
   joining CODE.
4. Trophies: `cr-clone-trophies=50`, lose (forfeit) a ladder match: 50
   stays 50 and the result shows 0; at 110 the dialog says −10 and 100
   is left. Seed `cr-clone-auto-history` at rookie and lose two ladder
   matches: `resolveTier('auto', …)` gives 'practice'.
5. Challenges (trophies >= 100): Events → Challenges lists 12 rows with
   goal chips and stars, no horizontal scroll, both editions, 390x844
   and 1280x800.

## Notes for the integrator
- main.ts `startLadder` exempts only `tier === "rookie"` from the bot
  archetype tweaks; practice still gets them (the cycle archetype makes
  it think every 6.8 s and push at 8). battle-clarity owns that line:
  `tier === "rookie" || tier === "practice"` keeps practice as tuned.
- After the sim-card-wave merge, re-run novice.test and the challenges
  solvability test. If a band fails, retune only this package's knobs:
  the TIER_PROFILES numbers and the challenge wave data.
- The left-match settle (battle-clarity) should go through
  `applyMatchResult`, which applies the trophy floors.
