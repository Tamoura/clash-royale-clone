# Auto graphics on slow devices, remembered per device (C44)

Round 2 of `notes/features/enhancement-plan-2026-11.md` ("Opens every time,
keeps every trophy"). No sim or protocol change: `src/game` is untouched.

## The problem

`QualityGovernor.sample()` threw away every frame slower than 0.25 s as a
hitch. On a device under 4 fps it never got a sample, so it stayed on L0
(full bloom, 2048 shadows, DPR 2) for good: planning measured 2.3-2.4 fps on
L0 through a 45 s battle against 5.7 fps at `?quality=low`, and the tutorial
at about 1.5 fps. Every session also started at L0, the Home diorama does
not sample, and the step into L4 recompiled every lit material mid-fight.

The feed itself was fine: `sampleQuality` (scene/post.ts) gives the governor
the real wall time between two drawn frames from `performance.now()`, not
main.ts's `dt` (which `frame()` clamps to 0.25 s). `frame()` is unchanged.
The only feed change is that it now also says whether the page is visible,
and a return from another tab re-arms the governor.

## What a kid sees

- An old tablet, a school Chromebook or a software renderer: the first
  battle on a new device turns smooth within a few seconds (or starts smooth
  if the GPU is on the first-guess table), and every later session starts
  smooth, with no stepping and no shader stall mid-fight.
- After the first battle on a device where Auto lands on Low, one toast on
  Home: "Graphics set to Low so the game runs smoother." /
  "ضبطنا الرسوميات على منخفض لتعمل اللعبة بسلاسة." (5 s, never mid-fight,
  once per device). It is shown only if Auto is still on Low at that
  moment: if a grown-up picked a level in Settings meanwhile (or the try one
  level up kept Medium), nothing shows and the one-time flag stays unset, so
  a real drop to Low later still gets its note.
- Settings > Display > Graphics: the Auto choice says what it picked,
  "Auto (now: Low)" / "تلقائي (الآن: منخفض)" (or Medium / High), read fresh
  each time Settings opens. On a phone it shows as "Auto" over a smaller
  "(now: Low)" (0.88em: 12.3 px at normal text size) in a slightly wider
  segment. On a 320 px phone with large text the small line wraps, and as a
  last resort the row does, so every choice stays inside it. Under a pin it
  is plain "Auto".
- A fast device: the picture does not change (it stays at L0 and remembers
  L0). Under Auto, each battle's countdown also compiles the L4 light state
  once per page load (item 6), so a later step never compiles mid-fight.

## How it works (src/render3d/quality.ts)

1. **Sustained slow = slow.** Next to the trimmed-mean windows, a plainer
   check counts every visible frame. A window closes after at least
   `SLOW_WINDOW` (2 s) and `SLOW_MIN_FRAMES` (5) frames; it is slow when at
   least 5 of its frames, and most of them, are over `HITCH` (0.25 s). A
   slow window sends Auto straight to L4. The single-hitch rule stays for
   the trimmed-mean windows (a lone spike never costs picture), and bursts
   of up to four back-to-back hitches never make a slow window. Frames while
   the page is hidden, and gaps over `PAUSE` (3 s), never count. The
   start-up grace (`WARMUP` 3 s, `SETTLE` 1.5 s after each screen change)
   now counts down on slow frames too, or a very slow device never got past
   it. A lock that already measured L4 as no faster does not jump; a lock
   from a flat walk (a frame cap) still does if the game becomes a slideshow.
2. **Remembered per device.** `configure(start, onSettle)` sets where Auto
   starts and who hears where it settles (once per level per session: a
   window measured fast enough, a lock, the bottom, or the result of the try
   up). post.ts writes that to localStorage `cr-clone-gfx-memory`:
   `{ v: 1, devices: [{ key, level, helped, build, at, failBuild, failAt }] }`,
   at most 4 devices (newest first), sanitised on every read (printable
   ASCII, capped lengths, levels 0-4 only, junk or anything over 4 KB read as
   empty) and written in try/catch (private mode or a full storage just
   forget). The key is the WebGL renderer string (`gl.RENDERER`, or
   `WEBGL_debug_renderer_info`'s unmasked name where Chrome masks it as
   "WebKit WebGL"; "unknown" when hidden) plus a screen bucket (long and
   short side to the nearest 100 CSS px, pixel ratio to the nearest half),
   e.g. `ANGLE (... SwiftShader driver)|800x400@1`. The build tag stored with
   it is the hashed script name (`index-DkUXVAY7`; "dev" on the dev server).
   The memory is never thrown away on a deploy.
3. **Try one level up, once per session.** From a remembered or guessed
   start above L0, after the first window there measures fast enough (under
   1/45 s), Auto tries one level up. If that level's next window is slow (or
   a slideshow) it steps back and records the failed try with the build; the
   next try then waits for a new build or a week (`REPROBE_RETRY_MS`). A
   device climbs back at most one level per session, and a device that is
   slow at its level (SwiftShader on L4) never tries.
4. **First guess for a brand-new device** (`firstGuessLevel`): software
   renderers (SwiftShader, llvmpipe, softpipe, "software", Microsoft Basic
   Render Driver) start at L4; the short `LOW_END_GPUS` table starts at L3:
   Mali-400/450/470 and T6xx/T7xx, Mali-G31/G51/G52, Adreno 3xx/4xx/50x and
   610, PowerVR SGX and Rogue GE8xxx, Intel HD 2000/2500/3000/4000,
   HD 400/405/500/505 and UHD 600/605, Vivante and VideoCore/V3D. Everything
   else starts at L0 as before. A guessed start, or a remembered one from a
   session where stepping down bought frame time (`helped`), may step into
   L4 without proving that again; a fresh L0 start keeps the old rule (the
   L4 step waits until some step has helped, so a frame cap never pays the
   shader compile).
5. **Pins win.** `?quality=` and Settings Low/Medium/High pin the level; the
   memory and the guess only decide where Auto starts, and nothing is
   remembered under a pin. Back to Auto starts at the level Auto last
   settled on.
6. **No mid-fight shader stall (scene/post.ts `prepareLightVariants`).** The
   L3/L4 line changes the light state (shadow map and rim light on or off),
   so every lit material needs a new program. L0 to L3 share one light state
   (only the map's size changes). Whenever Auto is in charge, at any level
   (`wantsLightPrepare`), the first frame of each battle (still in the VS
   and countdown, before the sim runs) compiles the other side of the line
   without drawing (`renderer.compile` into the composer's render target, so
   the program keys match the scene pass), then restores the lights. three
   keeps each material's programs per light state, so a later step into L4
   from any level (a slideshow jump from L0, or a walk through L3), or the
   try up from L4, finds them ready. A pin never steps by itself, so it is
   never prepared. (Before the review fix only L3 and L4 starts prepared, so
   an L0-L2 start that later stepped into L4 compiled mid-fight.)

Test switch: `?gfxguess=off` skips the first guess (to exercise the
slow-window path on SwiftShader, which is itself a software renderer).
Console lines: `[graphics] auto starts at L4 (memory) on <key>`,
`[graphics] pinned high (L0); auto would start at ...`,
`[graphics] auto: L4`,
`[graphics] prepared the other light state at L0 in 22 ms (32 new programs)`.
They stay on the device, like everything else here.

## Keys

- `cr-clone-gfx-memory`: the device memory above.
- `cr-clone-gfx-note-seen`: `'1'` once the Low toast was shown.

## Measurements

All on this machine (no GPU: SwiftShader, Chrome, 390x844 phone, DPR 1,
shared CPUs, so absolute numbers wobble). Scripts and raw JSON are in
`/tmp/claude-0/r2/graphics/` (`probe.cjs`, `prep2.cjs`, `ui.cjs`,
`settingsshot.cjs`; `base-a.json`, `prod-a*.json`, `prod-b.json`).

**Before vs after, fresh profile, Auto, CDP CPU throttle 4x, production
builds, back to back** (fps per ~1.2 s sample, from the hand appearing):

| Build | Level | fps |
|---|---|---|
| d5fda1d (before) | L0 for the whole run | 1.5-1.8 for 20 s, then 0.65-1.3 as the battle fills |
| this branch, `?gfxguess=off` | L0, then L4 6.4 s in | 0.8-1.8 on L0, then mostly 3.1-4.2 (median about 3.65, one dip to 2.6) |
| this branch, `?quality=low` (reference) | L4 pinned | mostly 3.7-4.7 (a few dips) |

Two more runs of the same: the step came 3.1 s in (L0 about 1.6 fps, then
3.3-4.0 fps) and 7.7 s in on a busier machine (L0 0.7-0.95 fps, then
1.4-2.3 fps). The time to the step is the 3 s start-up grace plus a window
of at least five slow frames: about 5 s at the planning's 2.4 fps, longer
when frames take a second each. The dev server without throttling: L0 at
1.2 fps, L4 about 4-5 s in, then about 3 fps.

**Reload (the next session).** Same profile, same throttle: `auto starts at
L4 (memory)`, no step-down sequence, 3.3-4.25 fps from the first second.
The guess path (no `?gfxguess=off`) starts at L4 straight away:
`auto starts at L4 (guess)`.

**The step into L4, with and without the prepared variants** (dev server, a
remembered-L3 start whose governor steps into L4 by itself mid-battle;
composer.render time, which blocks on shader link):

| | Programs compiled in the step frame | That frame |
|---|---|---|
| unprepared (PREPARE_FROM set to 9 for the run only) | 9, then 5 more in the next draws | 152 ms |
| prepared | 0 | 27 ms |

Preparing took 27-59 ms on the dev server and 7-150 ms in the production
runs (7-23 ms once the programs exist, as in a second battle).

**Preparing at every Auto start (review fix), L0 start** (dev server,
`?gfxguess=off`, fresh profile, per-frame log of `renderer.info.programs`;
scripts `/tmp/claude-0/r2/graphics-fix/jump.cjs`, raw JSON next to it):

| Run | Battle start | The L0 to L4 jump frame |
|---|---|---|
| old rule (L3+ only), no throttle | 14 programs; next frames 550, 483 ms | 9 programs compiled; 934 and 950 ms frames (L0 neighbours 583-1050, L4 after 317-333) |
| old rule, 4x throttle | 14 programs; next frames 1317, 900 ms | 9 programs; 1183 and 1483 ms (L0 883-1100, L4 after 449-634) |
| new rule, no throttle | 14 + 32 prepared in 22 ms of main thread; next frames 917, 550 ms | 0 programs; 500 and 717 ms (L0 483-550, L4 after 216-217) |
| new rule, 4x throttle (two runs) | 14 + 32 prepared in 78-81 ms; next frames 1083-2017 ms, then normal | 0 programs; 583-734 ms (L0 533-1000, L4 after 200-283) |

So the step frame no longer compiles anything. The cost moves to the
countdown: about 22 ms of main-thread time here (78-104 ms under a 4x
throttle), and on SwiftShader, which compiles on the CPU, the frame after
it was about 370 ms longer in the unthrottled run (the 4x runs are too
noisy to say). The 3-2-1 countdown holds the sim (ui/banner.ts), so the
field is still then. `compile` covers every material in the scene, hidden
ones too (tufts, outlines, region-culled strips), which is why it adds 32
programs where the step used 9. A second battle reuses them (5-23 ms in the
production runs). Only SwiftShader was available: on Chrome the shader
compile itself runs in the GPU process, not on the page's thread, but how
long the extra programs hold up the countdown's frames on a real phone or
laptop GPU was not measured.

Production re-check after the fixes (Classic, `?gfxguess=off`, 4x
throttle; `drive.cjs`): `auto starts at L0 (default)`, `prepared the other
light state at L0 in 104 ms (32 new programs)`, L0 at 0.67-1.68 fps, then
`auto: L4` 6.4 s after the cards (the machine was busier than in the first
runs: at about 0.7 fps the five slow frames take longer), then 2.2-3.2 fps;
the toast once on Home after battle 1; reload: `auto starts at L4
(memory)`, no step logs, 2.1-3.2 fps; Settings "Auto (now: High)" at boot,
"Auto (now: Low)" after the drop and after the reload.

**The stale-toast case (review fix)**, production, both editions,
`stale.cjs`: guess path (L4 at boot), High picked in Settings before any
battle, battle 1 (no preparation under the pin), Home: no toast, flag
unset. Back to Auto (L4 again), battle 2, Home: the toast once
(`shots/stale-{normal,arabic}-home{1,2}.png`), flag `'1'`. Battle 3: no
toast.

**The "(now: Low)" line (review fix)**, measured in Chromium at DPR 2:
12.3 px at text size 1 (was 10.9 px), 16 px at 1.3. At 390 px it stays one
line in both editions (60-82 px of a 99 px segment). The old nowrap line
already pushed the last choice out of the row at 320 px with larger text
(16 px over in Classic at 1.3; 22-49 px in Golden Age at 1.15-1.3); now
nothing leaves the row at 320 or 390 px at any text size
(`shots/row-wrap2-*.png`).

**Perf budget** (`node tools/perf-budget.mjs --matrix --url
http://127.0.0.1:3404`, pinned `?quality=high`): 4 runs within every gate,
the same as before (the 1440 empty-battle "over target" lines are report-only
and pre-existing).

| View | Edition | Empty calls | Empty tris | Fight calls | Fight tris | Fight textures |
|---|---|---|---|---|---|---|
| 390x844@2 | Classic | 102 | 251,230 | 179 | 628,222 | 77 |
| 1440x900@1 | Classic | 106 | 276,298 | 183 | 653,298 | 77 |
| 390x844@2 | Golden Age | 109 | 259,468 | 201 | 661,940 | 76 |
| 1440x900@1 | Golden Age | 115 | 277,648 | 207 | 680,120 | 76 |

**Settings and the toast, production, both editions** (`ui.cjs`: boot,
Settings, a battle left by Forfeit, Home, Settings, a second battle, a
reload, a third battle): Settings showed "Auto (now: Low)" /
"تلقائي (الآن: منخفض)" both times; the toast appeared once, on Home after the
first battle, never during a battle, and not after the second battle or the
reload. Screenshots: `/tmp/claude-0/r2/graphics/shots/prod-{normal,arabic}-*.png`
and `dev-settings-{normal,arabic,medium,high-ar}.png`.

## Tests

`src/render3d/quality.test.ts`: steady 0.4 s frames reach L4 within the
grace plus one slow window; 1.5 fps too, and it stays at L4; isolated 0.6 s
spikes and bursts of four hitches do not; windows where hitches are at
least five but a minority do not ("most frames"); gaps over PAUSE, alone or
between slow frames, do not; a hidden tab does not; pins and a
lock that measured L4 do not move; a frame-cap lock still jumps; rearm grace;
remembered start with no step-down; settle reports once per level; the try
up kept when fast, stepped back when slow or a slideshow, never from L0,
never without leave, never twice after Settings round trips; memory round
trip, kept across builds, failed try waits for a new build or a week,
sanitising (junk, wrong shape, bad levels, odd characters, duplicates, more
than four devices, oversize), storage that throws; keying (rotation-proof
buckets); the first-guess table both ways; pins over memory and guesses;
level names. `src/render3d/gfxNote.test.ts`: the toast's state machine
(after a battle only, once per device, once per session with blocked
storage; no toast and no flag when a pin or a kept try up came between the
queue and the calm screen, with a fake and with the live governor), the
Settings label, the build tag. `scene/post.test.ts`: renderer string
reading, the light-variant preparation (state flipped for the compile,
restored after), and a battle start under Auto preparing once at L0 while a
pin never does. Mutation check: dropping the "most frames" rule, the PAUSE
check or the toast's re-check each fails at least one test.

## Not done or not verified

- Only SwiftShader was available. The first-guess table, the renderer
  strings of real low-end GPUs, Firefox's and Safari's answers, and whether
  a real old tablet's frame times look like these were not tested on
  devices. Safari reports "Apple GPU" for every iPad, so all iPads share one
  memory key per screen bucket (fine: they start at L0 and the memory then
  follows what they measure).
- The Home diorama still does not sample (it renders every other frame on
  purpose), so a new device's first slow window is in its first battle.
- The countdown cost of preparing on a real GPU (item 6) was not measured:
  only SwiftShader was available.
- Under 1 fps the step takes longer than 5 s (five slow frames after the
  grace); devices slower than one frame per 3 s count as pauses and do not
  step at all.
