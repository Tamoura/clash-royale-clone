# Draft + Challenge modes (Track D)

Branch `draft-challenge-modes`, stacked on `enhancement-wave-1` (PR #97).

## Draft mode
- Pure logic in `src/game/draft.ts` (seeded, deterministic, TDD).
- 8 rounds. Each round offers 3 distinct cards from the FULL card pool
  (like CR's Mega Draft — ignores arena unlocks; avoids tiny early pools).
- Player picks 1; the bot secretly takes 1 of the remaining 2 (seeded rng).
  After 8 rounds both sides have 8 unique cards; battle starts normally.
- No card repeats across the whole draft (24 cards drawn from 29).

## Challenge / puzzle mode
- Scenarios in `src/game/challenges.ts`: fixed player deck, scripted enemy
  waves (`{at, cardId, x, y}` deploys via spawnUnits), survive-N-seconds
  win condition; lose instantly if a player tower falls.
- Bot does NOT think during challenges — waves are the whole script.
- First completion of each challenge grants gold (via meta profile).

## Daily challenge
- Seed = hash of local date (YYYY-MM-DD) → deterministic shared mirror
  deck of the day; beat the bot with it once per day for bonus gold.
- Completion stored in the profile as the date string.

## Decisions
- Entry points on the Home screen: 🎲 Draft, 🧩 Challenges, 📅 Daily chip.
- Draft/challenge/daily battles: no trophies; gold only as noted above
  (challenges/daily), draft grants the normal win gold but no trophies.
  KISS: reuse mode="solo" battle flow with explicit decks.
- Sandbox reset button stays sandbox-only.

## Status
- [x] draft.ts logic + tests
- [x] challenges.ts logic + tests
- [x] daily.ts logic + tests
- [x] UI wiring (home entries, draft picker screen, challenge list,
      battleKind dispatch: restart replays the same mode; only ladder
      matches call applyMatchResult)
- [x] Browser verification (draft flow live in Chrome; challenge waves +
      lose-detection headless)

Gotcha found while verifying: the game's rAF loop pauses when the Chrome
window is hidden/occluded (browser behavior) — battles only run while the
window is visible. Headless puppeteer keeps rAF alive, so use it for
unattended battle verification.
