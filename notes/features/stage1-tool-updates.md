# Stage 1: build and test tools updated (2026-11-16)

Branch `stage1/deps` merged into `claude/game-visuals-character-balance-w122wb`.
`npm audit` found 10 warnings (1 moderate, 7 high, 2 critical), all in the
tools we use to build and test the game. The tools below were moved to
versions with published security fixes. `npm audit` now finds 0.

## Which tools moved

| Tool | Before | After |
| --- | --- | --- |
| vite (builds the game, dev server) | 6.4.3 | 6.4.6 (newest 6.x) |
| vitest (runs the tests) | 3.2.6 | 5.1.0 |
| puppeteer-core (speed budget, screenshot tools) | 25.1.0 | 25.17.0 (newest 25.x) |
| vite-node (runs `balance`, `lab`, `relay`) | 3.2.4, brought in by vitest 3 | 3.2.4, now listed on its own |
| postcss, nanoid, source-map-js (inside vite) | 8.5.15, 3.3.12, 1.2.1 | 8.5.33, 3.3.20, 1.2.2 |

None of these are inside the game or the game server. The packages the game
and the server really use are unchanged: three 0.184.0, ws 8.21.0 and the
fonts 5.3.0. puppeteer-core 25.17 wants a newer ws, so it gets its own copy
(8.23.0); the server keeps 8.21.0. The battle code is untouched:
`git diff e34bbd4 -- src/game` is empty, and `SIM_VERSION` and
`PROTOCOL_VERSION` are still 3.

## What else changed, and why

- **Tests keep their old mock rule.** Vitest 5 forgets every mock's call
  history before each test unless told not to. Our tests were written with
  the history kept (they clear it themselves where needed), so
  `vite.config.ts` sets `clearMocks: false`. Every check means what it did
  before. No test file changed.
- **vite-node is listed on its own.** Vitest 3 used to bring it in and
  vitest 5 does not. `npm run balance`, `npm run lab` and `npm run relay`
  need it.
- **Node 22.12 or newer.** Vitest 5 and puppeteer-core 25.17 do not run on
  Node 20. `package.json` now asks for Node 22.12+, 24 or 26+ (vitest does
  not support 23 or 25). The relay check on GitHub moved from Node 20 to 22.
  The Pages check, Render and the Dockerfile already used Node 22.
  The LAN play guide (`docs/deploy-multiplayer.md`) says the same.
- **Why vitest 5 and not 4.** Vitest 4.1.12 would also clear the warnings,
  but npm 10 (the npm that comes with Node 22, used by GitHub and Render)
  stops with an error when installing it in this project. Vitest 5.1.0
  installs cleanly.

## How it was checked

- Typecheck clean. Tests: 179 files and 2,691 tests before and after, all
  passing, with the same test names. Also with `--silent`, as CI runs it.
- `npm audit`: 0, also after a clean `npm ci` and after a Render-style
  install (`NODE_ENV=production npm ci --include=dev`).
- Builds compared with the old tools: same files and sizes. With the build
  stamp held fixed, the GitHub Pages build and the `build:all` build are
  byte-identical to the old ones. The server file `dist-server/relay.mjs`
  is byte-identical.
- `npm run balance` and `npm run lab` print the same results as before.
  `npm run relay` starts and answers its health check. The dev server loads
  the game with no errors. The speed budget (`perf:budget`): 4 runs within
  every limit. `npm run play` (run on other ports) starts the game and the
  relay.
- Browser test on the production server after the merge (30 of 30 checks,
  no page errors, no console errors, no failed requests):
  - Classic and Golden Age both load.
  - A bot battle runs in each (clock 3:00 to 2:56).
  - Play online creates a room in each. A second player opens the copied
    invite link, the match starts for both, and the clock runs on both.
    (Two game pages drawn by one computer without a graphics card are slow
    here: about 20 s to see the clock move. The game files are the same as
    before, so this is the test machine, not the update.)
  - A first visit goes through the edition choice into the tutorial battle,
    in both editions.

## Left for later

- vite-node 3.2.4 is the last version that works with vite 6, so it will
  not get more fixes. Later, move `balance`, `lab` and `relay` to another
  runner, or move to vite 7 or newer.
- `tools/shot.cjs` was already out of date before this (it looks for an old
  home screen button and does not skip the tutorial). It was not changed.
- A later `npm update` or `npm dedupe` could move the server's ws from
  8.21.0 to 8.23. That is fine, but check the server after it.
- Anyone running the game on their own computer (`npm run play`) needs
  Node 22.12 or newer.
