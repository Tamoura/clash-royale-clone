# Stage 0: safer friend games and safer publishing (2026-11-16)

Two branches merged into `claude/game-visuals-character-balance-w122wb`:
`stage0/relay-safety` (friend games) and `stage0/repo-deploy` (the project
and how it is published). The battle itself did not change: `src/game` is
untouched, and `SIM_VERSION` and `PROTOCOL_VERSION` are still 3.

## What changed, and why

- **Friend games only use our own game server.** The published game
  (Render, GitHub Pages, `npm start`) talks only to the game server it was
  built with. A `?relay=` link is ignored, a server remembered from an older
  link is wiped when the game starts, and invite links carry only the room
  code. Before, a link could point a child's online play (name, crest, deck
  and taps) at another server, the game remembered it, and invite links
  passed it on. Developers can still try another server with `?relay=` on
  the dev server opened at `localhost`; the tablets in `npm run play` ignore
  it.
- **The game checks what the server sends.** Names go through the same
  rules as the name box, a crest must be one of the 12, towers, abilities
  and decks must be ones the game knows, and match settings must be in the
  server's own ranges. A bad name, crest, tower or ability gets a safe
  default; a bad move message is dropped; a bad match start ends the
  connection with the message the game already had ("The game server
  didn't understand us"). No new screens or words.
- **Reference card pictures removed.** `docs/cr-reference` (25 official card
  pictures and two notes about them) is gone. Nothing in the game, the build
  or the tests used it. Official game art must not come back
  (`notes/features/cr-character-design-refs.md`).
- **One publishing branch.** The Pages workflow now runs only for pushes to
  `claude/game-visuals-character-balance-w122wb` (and manual runs), the same
  branch `render.yaml` follows. The old branches `main` and
  `feature/arabesque-theme` still carry their own old copy of the workflow,
  so a push to one of them could still publish their old game. Only the
  GitHub setting in owner task 1 below stops that; no file in this branch
  can.
- **Live only after the checks pass.** `render.yaml` now says
  `autoDeployTrigger: checksPass`. Updates still go live by themselves
  within minutes, but only after the typecheck and tests on GitHub pass, so
  a broken build never reaches the kids. The Pages copy already waited for
  the same checks.
- **The Pages copy plays online.** Its build now uses the Render game
  server (`wss://clash-royale-clone.onrender.com/ws`) unless the `RELAY_URL`
  repository variable names another. Before, that variable was empty, so
  the Pages copy had no online play unless a `?relay=` link had been opened
  on that device.

The deploy guide (`docs/deploy-multiplayer.md`) explains all of this.

## How it was checked

- Typecheck clean. Tests: 179 files, 2,691 tests, all pass. `npm run
  build:all` builds. `git diff 695ee94 -- src/game` is empty.
- Speed budget (`perf:budget`, both editions, phone and desktop sizes): all
  4 runs within every limit (fight 178-207 draw calls, 628k-680k
  triangles). No drawing code changed.
- Size: the main game script grew by 3.4 KB (1.2 KB compressed); every
  other file is the same size.
- Browser test on the production server (63 of 63 checks passed, no page
  errors, no console errors):
  - A page opened from a `?relay=` link to another server, with another
    server also remembered: the remembered one was wiped at start, and the
    only connection went to the page's own server.
  - Classic friend game: the copied invite link was just `/?join=CODE`. The
    friend opened it with a `?relay=` added (and another server
    remembered). The match started for both, each saw the other's name and
    crest, and every connection went to our own server.
  - Golden Age friend game: the same, with Arabic names.
  - A Pages-style copy (plain files under `/clash-royale-clone/`, game
    server running separately): the same, with every connection going to
    the server built into the page.
  - Phones hide the opponent's crest chip to make room for the name (as
    before), so the crest was checked on a tablet-sized screen.

## For the owner (one-time settings)

1. **GitHub:** Settings > Environments > github-pages > Deployment branches
   and tags. Choose selected branches and allow only
   `claude/game-visuals-character-balance-w122wb`. This stops the old
   branches from publishing.
2. **Render dashboard:** open the game service, Settings, Build & Deploy.
   Auto-Deploy should read **After CI Checks Pass**, and the branch should
   be `claude/game-visuals-character-balance-w122wb`. If the service was
   made from the Blueprint, a Blueprint sync (Manual Sync) applies
   `render.yaml`. If it was not made from the Blueprint, set both there by
   hand.
3. **GitHub email privacy:** Settings > Emails. Turn on "Keep my email
   addresses private" and "Block command line pushes that expose my email".

Nothing else needs setting: the Pages copy uses the Render game server by
default. Set `RELAY_URL` only if that server's address ever changes.
