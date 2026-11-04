# Feature: online-truth

Branch: `wip/online-truth` (wave 1 of the enhancement round, from a1ed21f)

Online play tells kids the truth: a forfeit is the forfeiter's loss, your own
towers are always your colour, a rematch request is seen by the other
player, a friend who leaves is named as such, and a code typed with a dash
still joins.

## What changed

### 1. A forfeit settles as an online loss (`src/net/session.ts`)

Before: `forfeit()` called `leave()`, which made `inMatch` false, so
`onlineSession()` returned null before main.ts handled the `finish` event.
`finishMatch()` then ran as a solo ladder match from the `player` seat: the
guest who forfeited saw VICTORY and got +30 trophies, gold and a chest.

Now `forfeit()` leaves the room (the relay gets `leave`, every timer stops,
nothing more is sent) but keeps `battle`, `side` and `inMatch` until
`leave()` (result OK, Home, the lobby). main.ts is unchanged and sees
`online=true` and the real seat, so `settleMatch` takes the online path: no
trophies, gold or chest, the forfeiter's result is DEFEAT. `step()` never
ticks a decided battle (a result decided outside the lockstep is settled
as finished).

The winner learns how the opponent quit (`session.opponentExit`):

| What happened | Wire | `opponentExit` | Result line |
| --- | --- | --- | --- |
| Opponent pressed Forfeit | `peer-left` while the peer was connected and on screen | `gave-up` | "Your opponent gave up" |
| Opponent closed the page | `peer-paused` then `peer-left` (visibilitychange, and `pagehide` now says paused before it leaves) | `left` | "Your friend left the match" |
| Opponent's link died | `peer-dropped`, then `peer-left` after the 20 s grace (or our 25 s stall limit) | `left` | "Your friend left the match" |
| Opponent left after the match | `peer-left` in the ended phase | `left` | "Your friend left the match" |

No new client message was needed (the protocol may only gain `peer-rematch`
this wave); Forfeit is the only way out of a running match on a visible
page, so a leave from a healthy peer is a forfeit.

### 2. Team colours for the player who joins (`views/towers.ts`)

Every team cue on a crown tower comes from `towerTeamColors(e.side)`, which
maps the sim side through `teamSide()` (troops.ts): roof caps, banner,
banner tip, flag cloth, platform and brick tint, the HP bar (via
`unitHpColor`, so the colour-blind pair applies) and the baked crew's cache
key. The level shield already went through `teamSide()`. Positions and
facing (crest, door, outward plate, defender mount) stay on the sim side.
`towerCollapse.ts` and the rubble are not side-coloured; nothing to change.

Also fixed while checking the guest's view: each tower's HP number sat 0.2
behind its bar as the guest's flipped camera sees it, so the bar hid every
tower's HP for the joiner. It now sits on the camera side for either view.

### 3. Rematch offers reach the other player

- `protocol.ts`: one new `ServerMsg` member, `{ t: "peer-rematch" }`
  (additive; `PROTOCOL_VERSION` untouched).
- `rooms.ts`: `requestRematch(conn)` = `rematch(conn)` plus `peer-rematch`
  to the other seat while it has not asked. `rematch()` itself is unchanged
  (rooms.test.ts pins its exact output); `server/relay.ts` calls
  `requestRematch`.
- `roomClient.ts`: `onPeerRematch`. `session.ts`: `peerWantsRematch` (true
  only while a rematch is still possible; cleared by a new match or the
  peer leaving).
- Result screen: `OnlineOverlay.resultLine()` is a live element that
  `match/online.ts` places in the result panel through `registerResultExtra`.
  It updates in place every frame, so an offer that lands after the result
  is up shows at once:
  - offer: a bouncing banner "Your friend wants a rematch! Tap Rematch"
    (quick match: "Your opponent…") with its own Rematch button
    (`restartOnline`);
  - gave up / left: the line plus a "Find a new game" button (dismisses the
    result, leaves the room, opens the lobby);
  - the forfeiter's own result: "You gave up this match" plus the same
    "Find a new game" button.
  It sits in the panel (not over it), so it never covers the result and
  scrolls with it on landscape phones (it scrolls itself into view when it
  changes). Golden Age: `dir="rtl"`, icon at the start (right).
- The result's own Rematch button (`render3d/result.ts`, not ours) steps
  aside whenever the session can no longer rematch (`resultRematchOpen`:
  `canRematch()`, or our own request still waiting). It would only have
  opened the lobby, so a child who read "Your opponent gave up" and tapped
  Rematch landed in the lobby. The line carries `data-rematch="yes|no"`, kept
  live every frame, and `online.css` hides `.res-again` and gives OK the whole
  row with `#overlay .res-panel:has(.oo-offer[data-rematch="no"])`. So after a
  forfeit (both screens), a page close, a drop, or a leave after the match,
  the buttons are "Find a new game" and OK, never two lobby buttons.
  Browsers without `:has()` keep the old button, which still opens the lobby.

### 4. Peer left

Covered by 1 and 3: the winner's result gets "Your friend left the match"
(EN/AR) keyed on `endReason === "opponent-left"` plus `opponentExit`, and the
mid-match banner (`opponentLeftBanner`) says "gave up" or "left" to match:
"Your friend left — you win!" in a friend game, "Your opponent left — you
win!" in a quick match. A forfeit reads "Your opponent gave up" in both
(the spec's wording), on the banner and the result line alike.

The relay sweep runs every 5 s (was 30 s), so a dropped friend's grace ends
within ~5 s of the countdown reaching zero instead of up to 30 s later.

### 5. Codes (`net/codewords.ts`, `ui/screens/lobby.ts`, `match/online.ts`)

`normalizeCode()`: strip every non-alphanumeric character, upper-case, and in
the number after a code word read O as 0 and I as 1 (`CODE_DIGITS` has no
letters; the word itself is left alone, and base32 codes have no O or I).
The lobby exports it as `sanitizeCode` for the code box (live, as you type);
`cleanCode` (join button and `?join=` links) uses the same rule.
`'carp-86 '` becomes `CARP86`, `'lion4o'` becomes `LION40`.

### 6. `roomClient.ts` guards

`NetSocket.readyState` (optional, so fakes still work): nothing is written
unless it reads OPEN. `leave()` stops the pings and the connect timer at
once (the browser reports the close a moment later; a ping in that gap was
the "WebSocket is already in CLOSING or CLOSED state" console error), drops
the backlog, and is safe to call twice. The close is still reported once,
when it lands.

### 7. Names

A quick-match opponent without a name is "Opponent"/"خصم" (HUD, versus card,
the lobby's found card, the result); friend games keep "Friend"/"صديق"
unless the loadout carries a name. `session.quickMatch` says which.

The overlay's sentences follow the same rule (`overlayCard(view, prev,
quick)`, `opponentLeftBanner`, `offerContent`): the rematch waiting card
("Your friend needs to tap Rematch too."), the "Your friend left" card when
a rematch can't happen, and the mid-match "left" banner say "friend" in a
friend game and "opponent" in a quick match. The Arabic waiting card names
the button by its label, «مباراة ثأرية», as the offer banner does.

## Tests

- `src/net/session.forfeit.test.ts`: guest forfeit (inMatch true, side
  enemy, winner player, host told "gave-up"), host forfeit (winner enemy),
  `leave()` ends inMatch, nothing sent after a forfeit, closed page vs drop
  vs leave-after-match, quick-match flag.
- `src/net/rematch.test.ts`: relay `requestRematch` (both seats, dropped
  seat, plain `rematch()` unchanged), client `onPeerRematch`, session offer
  end to end (offer, accept, identical checksums; withdrawn when the asker
  leaves), the result line mapping and its EN/AR words (including the
  forfeiter's line), when the result's own Rematch button steps aside
  (finished, our request waiting, peer left after the match, both sides of
  a forfeit), a source check that `render3d/result.ts` and `index.html`
  still use the class names `online.css` targets (`#overlay`, `.res-panel`,
  `.res-pair`, `.res-again`), and the friend/opponent wording of the
  overlay cards and banners.
- `src/net/roomClient.guard.test.ts`: a browser-like socket (readyState,
  late close, console-error on a bad send).
- `src/render3d/scene/views/towers.test.ts`: real tower meshes under both
  viewpoints (flag cloth, HP fill, king), the colour-blind pair, HP number
  in front of the bar for both cameras, and a source check that no raw
  `SIDE_COLOR[e.side]`/`HP_COLOR[` comes back.
- `src/ui/lobbyCode.test.ts`: the sanitizer, generated codes unchanged,
  `cleanCode`, opponent fallback names.
- The in-memory relay harness moved from `session.test.ts` to
  `src/net/memRelay.testkit.ts` (not a test file; shared by the session and
  rematch tests; never imported by the app).

Node tests run the Golden Age edition (theme.ts defaults to arabic without
localStorage), so string assertions are the Arabic ones.

## How to verify

```sh
npx tsc --noEmit && npx vitest run --testTimeout=30000 && npm run build
npm run build:all   # then serve dist/ + dist-server/ from a scratch copy:
PORT=3721 node dist-server/relay.mjs
```

Two pages at 390x844, `?quality=low`, fresh profiles with
`cr-clone-tutored=1`, `cr-clone-arena-theme=normal|arabic`,
`cr-clone-trophies=120`, `cr-clone-gold=300`:

- (a) guest forfeits from the battle menu: guest DEFEAT with "You gave up
  this match", trophies/gold/chests unchanged; host VICTORY with "Your
  opponent gave up" (banner "Your opponent gave up — you win!"). Both
  results show exactly two buttons: Find a new game and OK (no Rematch).
- (b) host forfeits: host DEFEAT, trophies unchanged; guest VICTORY.
- (c) mid-match on both pages: own (bottom) towers blue flags/banners and
  green HP bars, top towers red; HP numbers visible on the guest too.
- (d) after a finished match the host taps Rematch: the guest's result shows
  the bouncing offer within ~1 s and the host's waiting card reads "Your
  friend needs to tap Rematch too." (AR «مباراة ثأرية»); the guest taps its
  Rematch, both start a new countdown. If the guest leaves instead, the
  host's card reads "Your friend left / No rematch this time." and the result
  behind it drops its Rematch button. (A finished match needs the dev server: the run used a dev
  page against the built relay, ending the match by time on the same tick
  on both peers.)
- (e) the guest types `hawk-87 ` (lowercase, dash, space): the box shows
  HAWK87 and the join succeeds.
- (f) the guest page closes mid-match: host banner "Your friend left — you
  win!", then VICTORY with "Your friend left the match" + Find a new game and
  OK (about 4 s: pagehide says paused, then leaves). A crashed tab (`chrome://crash`, no pagehide) shows "Opponent
  reconnecting…" and then the same result after the grace (26 s).
- (g) no "WebSocket is already in CLOSING or CLOSED state" and no page
  errors in any of the above (classic and Golden Age; 390x844, 360x740,
  844x390, 1280x800).

## For the integrator

- Outside `ownsFiles`, declared: `src/net/memRelay.testkit.ts` (new). The
  in-memory relay harness moved out of `session.test.ts` so
  `session.forfeit.test.ts` and `rematch.test.ts` share it. It is not a test
  file and the app never imports it; no other package owns it. It passes the
  client's own `PROTOCOL_VERSION` through (no version literal), and
  `rematch.test.ts` uses `PROTOCOL_VERSION` too. A trial merge of
  `wip/sim-card-wave` (3f5c942, PROTOCOL_VERSION 3, new cards) with this
  branch merges cleanly, and tsc plus the full vitest run pass on it. After
  rebasing onto sim-card-wave, re-run `session.test.ts`,
  `session.forfeit.test.ts` and `rematch.test.ts`.
- `online.css` hides the result's Rematch button by class name
  (`#overlay .res-panel … .res-again`, `.res-pair`). `render3d/result.ts`
  belongs to battle-clarity (and rewards-legendary in wave 2). If either
  renames those classes, the guard in `rematch.test.ts` fails. Then update
  the selector, or give `ResultData` a live "can rematch" flag and drop the
  rule. battle-clarity has nothing to do here unless that happens.

## Tuning numbers

- Relay sweep: 5 s (`SWEEP_MS`, server/relay.ts).
- Grace, stall limits and resume backoff unchanged (20 s, 25 s/28 s,
  500-4000 ms).
- Offer banner bounce: 1.6 s loop after a 360 ms pop; off under reduced
  motion.
