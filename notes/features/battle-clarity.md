# Feature: battle-clarity (enhancement round, wave 1)

Battles explain themselves. A kid always knows the goal, why they won or
lost, what a card does, and why a drop was refused.

## What changed

### 1. Refused drops say why, at the finger
- `selectCard(null)` always calls `clearPreview()`, so a ghost troop never
  outlives its card (the playtest found one parked on the enemy half).
- On a refused troop or building drop (`bad-spot`), `badSpotReason()`
  (`render3d/hudModel.ts`) picks the words and the HUD floats them over a
  red pulse ring (`Battle3D.badSpotPulse`, 1.2 s):
  - **"Your side only!"** when `canDeployTroopAt` says no (the enemy half
    while its lane is shut, the river);
  - **"Too close to a tower!"** when the spot is in an open lane but
    `checkDeploy` still refuses it: that can only be the sim's private
    `nearEnemyTower` clearance (not exported; the sim package owns it).
  The ghost hides at once; the card stays selected so the next tap can land.
- While a troop **or building** is selected (the Mirror counts as the card
  it copies), the enemy half is 45% darker on screen with a red line along
  your bank of the river. Tuning: `ENEMY_ZONE_OPACITY` in `scene3d.ts`.
  The material alpha is corrected for linear-light blending
  (`1 - (1 - 0.45)^2.2` = 0.73): the old 0.24 alpha looked like nothing.
  Measured on screen: the enemy half's mean luminance drops from 179 to
  86 (ratio 0.48) with a Knight selected.

### 2. KING not ready
- `triggerAbility` failure calls `hud.flashError("ability")`: the KING
  ring shakes and a "Charging… Ns" bubble pops over it for 1.5 s, with N
  from the side's own meter (`abilitySecondsLeft`). The elixir bar never
  shakes for the ability any more.

### 3. Keys
- "T" (edition switch + reload) only exists in dev builds.
- Esc drops the card in hand; with nothing in hand it opens the battle
  menu, and Esc again closes it (the sheet's own Esc handler). Hotkeys are
  ignored behind menus and while the battle menu is open.
- On `(hover: hover) and (pointer: fine)` devices, hand cards show 1-4
  badges and KING shows a Q badge (`hud.css`); touch devices never do.

### 4. Card info
- New `src/render/cardBlurbs.ts`: `Partial<Record<CardId, {en, ar, good,
  watch}>>` with a kid one-liner for all 38 stock cards plus a generic
  Studio line for the champion. EN uses the Classic names, AR the Golden
  Age names (Faris, War Elephant, Janissary…), matching the art each
  edition shows.
- Long-press a hand card (450 ms, under 8 px of movement): a big bubble
  above the hand (beside the panel in the wide layout) with art, name,
  cost, the blurb, and "Good vs" / "Watch out" mini portraits. The press
  never selects or deploys anything; release hides it. Tuning:
  `LONG_PRESS_MS`, `LONG_PRESS_SLOP_PX` in `hud.ts`.
- The desktop hover tip and the card info sheet (`cardInfo.ts`, above the
  stats table, with good-vs / watch-out names) show the same line.

### 5. Challenge goal
- `startChallenge` sets `hud.setClockGoal(battle, challengeClock(ch.surviveFor))`.
  The clock reads **"SURVIVE 0:45"** and counts down to the win; its
  caption reads "Challenge". A goal card ("Keep all 3 towers standing for
  0:45!") shows for ~5 s from the start. The tutorial (surviveFor 1e9) and
  every other mode keep the normal clock (`challengeClock` only counts
  down goals shorter than a match).
- The result explains the outcome: "You held on!" or "A tower fell! Keep
  every tower standing" (`resultReason`). A forfeit with all towers up
  gets no tower line.

### 6. Tiebreak
- In overtime a small "Tie? Weakest tower loses" line sits under the clock
  (inside the clock in the wide side panel).
- A finish decided on tower HP (crowns tied when overtime runs out) adds
  "Crowns tied: your weakest tower had N HP, theirs had M" under the
  ribbon; a draw reads the same. `weakestTowerHp` uses the sim's own
  `towerHpTiebreak` filter (buildings with no card), read at the finish
  frame. HP rounds up (a standing tower never reads 0).

### 7. Leaving early
- New `src/match/leftMatch.ts` (pure, injected `KV`). `announceMatchStart`
  marks solo ladder matches only (not sandbox, replays, the tutorial,
  draft / challenge / daily, or online) with `{at, trophies}`;
  `finishMatch` clears it (wins, losses, draws and forfeits).
- On boot, when no tutorial runs, a marker under 24 h old settles as a
  loss through `match/rewards.ts` `applyMatchResult` (so it follows the
  same trophy rules, including first-hour's floors after the merge), is
  removed (never charged twice), and Home shows "You left your last
  battle, so it counted as a loss" with the trophy change (battle-top
  home slot, until the next match starts).

### 8. Bot loadout fairness
- New `src/match/botLoadout.ts`: the bot's tower troop and King's ability
  come only from what the player has unlocked at their best arena
  (`featureUnlocked("towerTroops" | "abilities")`, the same reach rule as
  Battle setup). A 0-trophy bot uses Princess and Royal Rally.

### 9. Replay
- The speed control is a big 1x / 2x / 4x pill under the clock (placed in
  JS from the clock's rect, then pushed below the menu button or the wide
  panel's scoreboards if it would cover them).
- Tapes store an optional `opponentId` (the bot archetype) next to
  `opponent`; playback names the bot in today's edition. The tape version
  lines are untouched (sim-card-wave owns them).

## Files
Owned edits: `src/main.ts` (not the ReplayData `v` / storedReplay check or
the `leaveCost` lines), `render3d/hud.ts`, `hudModel.ts` (+ tests),
`result.ts`, `scene3d.ts`, `ui/battleMenu.ts` (`battleMenuOpen`),
`ui/style.css`, `ui/styles/hud.css`, `ui/icons.ts` (+ test: `fast`,
`hourglass`), `ui/screens/cardInfo.ts`; new `render/cardBlurbs.ts`,
`match/leftMatch.ts` (+ tests).

One new file outside the declared list: `src/match/botLoadout.ts` (+ test).
It keeps the loadout rule pure and tested instead of burying it in main.ts;
no other package touches it.

## How to verify
- `npx tsc --noEmit`, `npx vitest run --testTimeout=30000`, `npm run build`.
- Dev server, `?quality=low`, `cr-clone-tutored=1`, edition `normal`, a
  390x844 touch viewport:
  - drag a Knight onto the enemy half: "Your side only!" at the finger, a
    red ring, no ghost afterwards; with the Knight selected the enemy half
    is clearly darker with a red river edge;
  - tap KING early: KING shakes and says "Charging… 54s";
  - long-press a hand card: the bubble; nothing is spent;
  - Events > Challenges > Giant Trouble: "SURVIVE 0:45" and the goal card;
    lose a tower: "A tower fell!";
  - `__cr.battle()`: `overtime = true`, `time` just before
    BATTLE_DURATION + OVERTIME_DURATION, crowns 0-0, unequal princess HP:
    the result names both numbers;
  - start a ladder match and reload: Home's notice, trophies down by the
    ladder loss;
  - play a ladder match to the end, then Events > Last battle: the pill.
- Headless Chromium reports no pointing device (`hover: none`,
  `pointer: none`) and cannot emulate one, so the 1-4 / Q badges were
  checked by applying the rules of their `(hover: hover) and
  (pointer: fine)` block in the page; a real desktop browser matches it.

## Checked in Chromium (headless, SwiftShader)
All at `?quality=low`, deviceScaleFactor 1, both editions where noted; no
page or console errors in any of these flows.
- Refused drop at 390x844 touch: "Your side only!" 32 px above the release
  point, ghost hidden right after and 1.5 s later and after deselecting;
  "Too close to a tower!" inside the opened left lane by the king.
- KING at 1% charge: KING gets `error-shake`, "Charging… 54s";
  `.elixir-row` never gained `error-shake` (MutationObserver count 0).
- Built copy (`vite preview`): "t" / "T" mid-battle, no reload, edition
  unchanged. Esc: deselects, then opens the paused menu, then closes it.
- Long-press 600 ms at 390x844 touch and 1280x800 mouse: bubble with the
  blurb during the hold; elixir 10 → 10, entities 6 → 6, nothing selected.
- Giant Trouble (Classic and Golden Age, 390x844, 844x390, 1280x800):
  "SURVIVE 0:45" → "SURVIVE 0:43" after 2.5 s, the goal card, then "A tower
  fell!" or "You held on!".
- Tiebreak forced through `__cr.battle()`: "Crowns tied: your weakest
  tower had 404 HP, theirs had 1,200".
- Reload mid-ladder at 150 trophies: Home notice, 150 → 130; a second boot
  charges nothing; a finished match leaves no marker.
- Bot loadout: four 0-trophy matches all Princess + Royal Rally; six
  2000-trophy matches mixed all three of each.
- Replay pill: `elementFromPoint` at its centre hits the pill at 360x740,
  390x844, 844x390 and 1280x800, never over the menu; a Classic tape
  names its bot in Arabic in the Golden Age edition.
- Online friend game on a local relay: the guest (flipped view) gets the
  same drop label, dark far half and KING bubble; both peers stay in sync.

## Tuning numbers
| Knob | Value | Where |
| --- | --- | --- |
| Enemy-half darkening | 45% on screen (alpha 0.73) | `ENEMY_ZONE_OPACITY`, scene3d.ts |
| Refused-drop ring / label | 1.2 s | `BAD_SPOT_SECONDS`, `DROP_HINT_MS` |
| KING "Charging" bubble | 1.5 s | `CHARGING_MS`, hud.ts |
| Long-press | 450 ms, 8 px slop | `LONG_PRESS_MS`, `LONG_PRESS_SLOP_PX` |
| Goal card | 5.2 s | `GOAL_CARD_MS` |
| Left-match marker expiry | 24 h | `LEFT_MATCH_MAX_AGE_MS` |
| Replay speeds | 1x, 2x, 4x | `REPLAY_SPEEDS` |
