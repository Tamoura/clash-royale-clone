# Crash shield: never a frozen battle, a local problem log, a Problem report

Round 2 package `shield`, the runtime half of C43 in
`notes/features/enhancement-plan-2026-11.md` (the boot splash and the
no-WebGL screen are package `boot`). No sim change: `src/game` is untouched,
golden and bot tests unchanged, SIM_VERSION and PROTOCOL_VERSION stay 3.
Nothing is ever sent off the device: no remote crash reporting, no analytics.

## What a kid sees

- One stray error: nothing. The battle carries on.
- A glitch storm in a solo battle: the battle pauses behind **"Oops! Something
  went wrong." / "عذرًا! حدث خطأ ما."** with **Keep playing / تابع اللعب**
  (first, big, focused) and **Back to menu / العودة إلى القائمة**. Body:
  "Your battle is paused. Going back to the menu costs no trophies."
- It fails again within 10 s of Keep playing: the same title, "It happened
  again. The menu is the best place now. You lose no trophies.", and Back to
  menu becomes the first, big, focused button.
- A storm in an online match: the match stops on this device, "The match
  stopped because of a glitch. No trophies won or lost." / "توقفت المباراة
  بسبب خلل. لم تربح أو تخسر أي كؤوس." with only Back to menu.
- On a menu screen (Home, Collection...) nothing is shown: menus are plain
  page controls that keep working, so the shield only records.

The overlay is one at a time, sits over the HUD, the result screen and the
battle menu (under toasts), cannot be dismissed by Esc or a tap outside, and
keeps Tab on its two buttons; the battle keys behind it are blocked. Its
buttons always stack full width (long Arabic labels never wrap). Golden Age
reads it right to left.

## How it works

| Piece | File |
| --- | --- |
| `frame()` runs `frameBody()` through the shield | `src/main.ts` (`frame()` and the `installCrashShield` call above it) |
| Shield core: schedule-in-finally, storm counting, print throttle, `?oops=1` switch | `src/app/crashShield.ts` |
| Wiring: context, sim hold, overlay, exits | `src/app/shieldWire.ts` |
| Page-wide `error` / `unhandledrejection` listeners | `src/app/errorTraps.ts` (main.ts's first import) |
| Local problem log + plain-text report | `src/app/problemLog.ts` |
| Build id in the app | `src/app/buildInfo.ts`, `vite.config.ts` define |
| Battle events: every step guarded, each match settled exactly once | `src/match/battleEvents.ts` |
| No-contest exits | `src/match/noContest.ts` |
| Overlay | `src/ui/oops.ts`, `src/ui/styles/oops.css` |
| Settings > Help > Problem report | `src/ui/screens/problemReport.ts`, `src/ui/styles/problems.css` |

### The loop never stops

`frame(now)` is now `crash.shield.runFrame(() => frameBody(now), () =>
requestAnimationFrame(frame))`. The body never schedules (both old
`requestAnimationFrame(frame)` calls, the deck-picker early return and the
last line, are gone); `runFrame` schedules the next frame in a `finally`, so
a normal return, the early return and a throw from any line (sim, bot,
online stepping, hooks, `scene.render`) all get exactly one next frame. A
source test pins both facts. The placement preview's `safely()` helper also
records into the log.

### A glitch never costs a result (the battle events)

The frame drains the battle's event list once a frame. Each event runs
through a list of steps in main.ts (`battleEventSteps`: sound, scene effect,
the `battleEvent` hook, the cards-played count, the replay tape, the tower
fall, the bot's crown emote), and `playBattleEvents`
(`src/match/battleEvents.ts`) runs **each step on its own** through
`CrashShield.guard`: a throw is recorded, printed and counted toward a storm
like a frame error (the frame counts as failed once), and the next step, the
next event and the settle all still run. Then a `finish` event settles the
match through `MatchSettler`, which settles each battle (by object) **exactly
once**: it counts as settled before `finishMatch` runs, so a settle that
throws halfway never pays out twice. The settler is also a safety net: a
battle that is decided (`battle.result`) but never settled (its `finish`
lost) settles on the next frame. `finishMatch` is reached only through the
settler (a source test pins it), and the end emote inside it is guarded so it
cannot stop the `matchEnd` hook.

Why: before this, one stray throw in the fan-out (for example in the king
tower's collapse effect) lost the rest of that frame's events, the `finish`
among them. The shield carried on, as it should for one error, so the kid saw
VICTORY, nothing was paid out, and the next launch charged the left-match
loss ("You left your last battle"). Found by the blind review; checked fixed
in the browser (see Verification).

### Storms

- A storm is **3 errors within 2 s**, or **3 failed frames in a row** (that
  catches "every frame throws" on a device too slow for 3 frames in 2 s).
- On a storm the shield asks the app to hold the battle and show the overlay
  **once**; it does not count again or re-open until the kid picks a button.
  While the overlay is up, `registerSimHold(() => shield.holding)` holds the
  solo sim, countdown included (the loop keeps running and rendering).
- Keep playing: the overlay closes, counting starts afresh, the battle clock
  runs again. A storm within `AGAIN_MS` (10 s) opens the "again" version.
- Printing is throttled per identical message: printed at most once per 5 s,
  the rest counted ("(and 12 more like it)" on the next print). Every error
  is still recorded (identical messages get a repeat count in the log).
- On a storm the log is flushed to storage at once.

### Loud in development (choice for item 3)

`LOUD_ERRORS = import.meta.env.DEV || MODE === "test"`. In the dev server and
in vitest a caught frame error is recorded, counted towards a storm (the
overlay still opens), the next frame is **still scheduled**, and then the
error is **thrown on**, so it shows as an uncaught error with its own stack
(and fails any Playwright `pageerror` check). The window listener knows the
object was already recorded and does not count it twice. Identical messages
inside the 5 s print gap are counted, not rethrown, so a broken frame does
not flood the dev console with 60 errors a second. A production build
swallows the error after `console.error` and carries on. An error a guard
caught (a battle event's step) is thrown on the same way, at the end of its
frame, after the rest of the frame (and the settle) ran and the next frame
was scheduled.

Checked on the dev server (`?oops=1`): one `pageerror` ("Test glitch from
?oops=1..."), the overlay opened, the sim held while it was up, frames kept
coming, and the battle time advanced after Keep playing.

### Back to menu is no contest

How leaving settles today: Forfeit (battle menu) settles a loss through
`finishMatch`/`settleMatch` (trophies, the loss streak, the auto-difficulty
loss count); a reload or closed tab leaves the left-match marker
(`match/leftMatch.ts`), which the next boot settles as a loss. The glitch
exit (`leaveAfterGlitch`) does neither: it marks the battle as no contest
(`MatchSettler.noContest`, so a `finish` still queued, or the settle safety
net, never settles it later: frames play the old battle once more while the
cast gate loads the next one), clears the marker, releases the live-match
lock, dismisses the HUD sheets and opens Home. No `matchEnd` is
emitted and nothing settles, so trophies, the streak, quests, achievements,
the auto-difficulty record and chest slots stay as they were, now and on the
next boot. Each step is guarded and the others still run if one throws.
Only this path skips the loss; Forfeit and closing the tab are unchanged.

### Online: no contest on this device

On a storm while an online match is being played (`onlineSession()` and no
result yet), the device says "paused" (`setPaused(true)`), then leaves the
room (`leaveOnline()`): both are messages every client already sends, so no
protocol change. Leaving an online friendly settles nothing on this device
(friendlies never move trophies). A battle that already has a result gets
the solo overlay instead.

**What the other player sees today** (measured, host browser): about 2.5-3.5
s after the guest's overlay, the host gets the banner "Your friend left —
you win!" / "غادر صديقك — لقد فزت!" and the VICTORY result with "Your friend
left the match" and "Find a new game"; its friendly-wins counter
(`cr-clone-friendly-wins`) goes up by one; trophies do not move. Because the
guest said "paused" first, the host reads "left", not "gave up"
(`net/session.ts` peerLeft); if the host's own sim was stalled waiting for
the guest at that moment, the existing code ends it as no contest there
too. The host is not stuck: "Find a new game" took it straight to the lobby.

Only a storm ends an online match. A single stray error inside an online sim
step could, in principle, leave the two sims apart; the existing checksum
sync (`net/checksum.ts`) is what notices that. In practice an error in the
sim repeats every frame and becomes a storm within three frames.

## The local problem log

`localStorage['cr-clone-problem-log']`: a JSON array, newest first, at most
**20** entries. Each entry: first and last seen (ms), repeat count `n`
(identical messages are merged and moved to the front), kind (`frame`,
`error`, `promise`, `preview`), message (one line, at most 240 chars), the
first **4** stack lines (at most 160 chars each, with the site's origin and
query strings taken off), build id, screen (`battle/playing`, `home`...),
graphics (`<pref> L<n>`: L0 is the fullest level, L4 the lightest), edition
(`classic` / `golden-age` / `unset`) and whether an online match was on.

- Cleaned on the way in and again on the way out of storage: control,
  zero-width and direction-override characters become spaces, whitespace is
  collapsed, every field is capped, unknown kinds become `error`.
- The stored JSON never passes 24,000 chars (the oldest entries go first).
- Loaded lazily on the first record or read, so a broken or huge stored
  value costs nothing at boot and simply reads as an empty log.
- Written at most once a second while errors keep coming (no count is lost),
  and at once on a storm.
- Ignored: the gallery's deliberate `Error: gallery mode` stop and the
  browser's benign `ResizeObserver loop` notice.
- Errors before the screens exist are recorded with screen `boot` and the
  edition read straight from storage.

## Build id

`vite.config.ts` computes the build id once per config load (`buildId()` is
memoised) and both the service-worker stamp and a new
`define: { __APP_BUILD__ }` use it. `src/app/buildInfo.ts` exports
`BUILD_ID`, which is `"dev"` on the dev server and in vitest. Checked on the
production build: `dist/sw.js` `BUILD_ID` and the id in the app bundle are
the same string (e.g. `371526f-mwf0xih59ofj`), and the Problem report shows
it.

For integration with r2/boot: the define sits after the `build` block, away
from the plugin lines boot rewrites, so the two branches merge without a
conflict (checked with `git merge-tree`; r2/save and r2/graphics merge
cleanly too). In the merged file boot's module-level
`const BUILD_ID = buildId()` reads the same memoised id as the define, so the
ids still match. Optional tidy-up after the merge: set the define to
`JSON.stringify(BUILD_ID)` and drop the memo (`onceBuildId`/`freshBuildId`);
either way, rebuild and check that `dist/sw.js` and the index bundle carry
the same id.

## Settings > Help > Problem report

A row under "Replay the tutorial" opens a sheet: "Things that went wrong
lately, newest first.", a short list (time, `×3` count, the message as
recorded, the screen), or "No problems so far!" / "لا مشكلات حتى الآن!".
Buttons: **Copy / انسخ** and **Clear / امسح** (off when empty). Copy uses
`navigator.clipboard.writeText`; if that is missing or refused, the report
appears in a read-only box below, selected, and `execCommand("copy")` is
tried, with a toast either way. Small print: "Problems are kept on this
device only. Nothing is ever sent anywhere." and the `?oops=1` test switch.
The chrome is in the edition's language (Arabic-Indic digits through
fmtNum); recorded technical lines stay exactly as recorded, left to right.

In the copied report only the title, the header labels and the count line
follow the edition. Every problem's own lines (`#n ... · seen N times, last
... · kind`, the message, the stack, `Where: ...`) are in one plain Latin
form with Latin digits in both editions: a line mixing Arabic words with
Latin times and ids could be reordered by the bidi algorithm when pasted into
a chat app, and these are the lines a grown-up forwards. A test checks that
no Golden Age entry line holds Arabic script.

The copied text (Classic):

```
Crown Rush problem report
Build: b106594-mwewgx6yjco7
Browser: Mozilla/5.0 (...)
Screen: 390x844 @1x
Graphics: auto L4
Edition: classic
Made: 2026-11-13 11:37:15 UTC

2 problems, newest first. Kept on this device only.

#1 2026-11-13 11:36:58 UTC · seen 3 times, last 2026-11-13 11:36:58 UTC · frame
Error: Test: drawElements failed (forced by the acceptance driver)
  at P.drawElements (...)
  at Ff.l [as render] (/assets/three-f4GkQ5GL.js:3964:3764)
Where: battle/playing · auto L4 · classic · b106594-mwewgx6yjco7
```

## A grown-up's test switch: `?oops=1`

Open the game with `?oops=1` (for example
`https://clash-royale-clone.onrender.com/?oops=1`). The next battle throws a
test error ("Test glitch from ?oops=1 (a grown-up's test switch)") inside
`frame()` on 3 frames in a row, 3 s into play, so the Oops overlay appears.
It throws before the frame's sim step, so the battle itself is not touched;
it is that tab only; the parameter is taken off the address bar at once, so
a reload does not glitch again. The entry it leaves in the Problem report
can be cleared with Clear. In an online match it ends that match as no
contest, like a real storm.

## Storage keys

- New: `cr-clone-problem-log` (for the save package's key registry).
- Read only: `cr-clone-arena-theme` (edition at boot), and the existing
  `cr-clone-left-match` marker is cleared by the glitch exit.

## Verification

- Unit tests: `src/app/crashShield.test.ts` (next frame scheduled after a
  throw at the start, middle or end of the body, for non-Error throws, when
  record/print/overlay all throw, and before a dev rethrow; storms open the
  overlay exactly once; slow-device storms; again; menus; print throttling;
  `guard` (the frame goes on, counts as failed once, loud at the frame's
  end); the `?oops=1` switch; main.ts wiring),
  `src/match/battleEvents.test.ts` (a step that throws on the king's fall
  before `finish` still settles and clears the left-match marker; a throw on
  the finish itself; the rest of the batch still plays; exactly once; the
  safety net; a settle that throws is never repeated; with the real shield:
  storm counting and dev loudness; main.ts reaches `finishMatch` only through
  the settler), `src/app/shieldWire.test.ts` (storm routing with a mocked
  overlay and sim-hold registry: solo 'glitch' and 'again', the hold while
  open, Back to menu as no contest, the online stop, a decided battle, a
  menu screen, `?oops=1` taken off the address bar),
  `src/app/errorTraps.test.ts`,
  `src/app/problemLog.test.ts` (cap, merge, sanitise, broken storage, write
  throttle, report text), `src/match/noContest.test.ts` (trophies, streak and
  `matchEnd` untouched now and on the next boot), `src/ui/oops.test.ts`,
  `src/ui/screens/problemReport.test.ts` (fake DOM: list, Copy, fallback,
  Clear, header).
- Production build + relay, phone 390x844, both editions:
  `?oops=1` -> overlay -> clock held while open -> Keep playing (clock runs)
  -> a WebGL `drawElements` patched to throw 3 times -> overlay -> Back to
  menu -> Home with trophies and streak unchanged, also after a reload (only
  the problem log key changed) -> Problem report lists both entries -> Copy
  -> clipboard text. A separate run throws in `drawElements` right after
  Keep playing and gets the "again" overlay. A real two-browser online match
  where the guest opens with `?oops=1`: the guest ends as no contest with the
  message, trophies unchanged; the host gets "Your friend left — you win!"
  and reaches the lobby. Desktop 1440x900, both editions: overlay, report,
  Clear -> "No problems so far!". No page errors in any production run.
- After the review fixes (fix round 1), re-run on a fresh production build
  (`371526f-mwf0xih59ofj`): a one-off throw in a battle event's sound on the
  frame a forfeit finishes the match (`createOscillator` patched to throw
  once inside a frame) -> console "[shield] battle event 'finish' failed",
  the DEFEAT screen with -20, the left-match marker cleared at once, 300
  trophies after a reload and no "You left" note (one entry in the log, no
  page errors). Golden Age `?oops=1` run again: the copied report has Arabic
  title and labels and Latin entry lines. Classic "again" run and the
  two-browser online run (Golden Age guest) again: unchanged results.
  Dev server, the reviewer's own repro: a one-off throw in the king tower's
  collapse effect as the kid wins -> VICTORY with +30, a chest and Crown
  Pass, marker cleared, 350 trophies after a reload, no "You left" note (the
  error still shows as a page error: loud in development); the same for a
  forfeit hit by a one-off throw (Golden Age): -20 once, no left note.

## Known limits

- History: commit b106594 is a "WIP checkpoint" saved after a container
  restart; 259f54c replaces its CSS and explains the change. History is not
  rewritten.
- `emit()` (src/app/hooks.ts) already catches a throwing hook listener and
  prints it with `console.error`; those are not in the problem log (hooks.ts
  is outside this package).

- Errors outside the frame (a tap handler, a timer) are recorded by the
  window listeners but never open the overlay: the UI around them keeps
  working, and a broken battle shows up in the frame soon enough.
- An error part-way through a solo sim step leaves that step half done;
  Keep playing goes on from there (the kid's choice), Back to menu is the
  safe way out and costs nothing.
- An entry holds what the error said and where in the code it happened (the
  site's address is taken off); the copied report adds the browser's user
  agent and the screen size. A grown-up sees all of it before pasting it
  anywhere.
