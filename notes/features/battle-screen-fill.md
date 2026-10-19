# Battle screen fill: a bigger board on every screen

The whole app used to be a phone-shaped column (`#app { width: min(100vw,
52vh) }`), so on a laptop the battle was a ~470px strip in the middle of a
dark page, and a landscape phone got a 203px sliver. Battles now use the
whole screen; menus and the home diorama keep their column. Nothing under
`src/game/` changed: the 18x32 tile arena, balance, golden and determinism
tests and online lockstep are untouched. This is only how much of the screen
the board takes and how big troops and towers draw.

## The frame (`src/render3d/scene/fit.ts`)

`fitBattleFrustum(w, h, insets, box)` fits a content box (camera-space
half-width, depth and centre) into the canvas minus the HUD's insets on all
four sides and returns a frustum covering the whole canvas (the canvas
aspect, so nothing stretches; the scenery fills the space behind the HUD).
With only a top inset it reproduces the old `frameOrtho` exactly (tested
against a verbatim copy, plus golden values).

- `BATTLE_BOX` = half-width 9.95 (field + edging), depth 26.8 (near fence to
  far lanterns), centre 0.6: the old numbers.
- `TALL_BOX` = half-width 9.25: portrait keeps a 0.25-unit sliver of side
  edging instead of 0.95. Phones are width-bound, so that is +7.5% per tile.
- The camera takes a `Framing` (insets + box) through `Battle3D.setFraming`.
- The canvas follows its container with a `ResizeObserver` (window resize
  only as a fallback). Before, a CSS-only size change (the card tray filling
  in when a battle starts) left the backing store at the old size, resampled
  into the new box.

## The layout (`src/ui/layout.ts`, `src/ui/layoutWire.ts`)

`battleLayout(w, h, safeArea)` builds both candidates (`tallLayout`,
`wideLayout`) from the stylesheet's own numbers and keeps the one that draws
the bigger board (`tile`, CSS px per tile). `layoutWire.ts` applies it only
while a battle is on screen (`closeDeckPicker` / `showPicker` call
`setBattle`): `:root[data-layout]`, `[data-side]` (narrow under 240px),
`[data-panel]` (stacked / inline), `--side`, `--field-w`, `--card-w`,
`--hand-cols`, `--hand-w` for the CSS, and the matching framing for the
camera. Keep the constants at the top of `layout.ts` in step with
`styles/hud.css`.

- **wide**: two side panels, the hand on the right, the clock, menu, scores,
  King and chat on the left. When both panels (at least 176px, `SIDE_MIN`)
  fit beside a full-height board (0.7425 x the height, plus an 8px gap each
  side) the board is height-bound and centred; panels are at most 320px and
  hug the board (`--hug`). On narrower windows (near-square and small
  landscape ones) the panels keep 176px and the board gives up height
  instead (width-bound between them), so the board shrinks smoothly as a
  window narrows: no cliff at a threshold. The camera insets are the panels
  plus their gaps, so they never cover a tile. Panels of 240px and up keep
  the 2x2 hand with Next beside the elixir bar; narrower ones take whichever
  arrangement gives the biggest cards (a 2x2 or one tall column, Next beside
  the bar or on its own row on top so the bar gets the full width), with the
  cards sized for the panel's height and the safe area (`handPanelHeight`).
- **tall** (phones, portrait tablets): the board spans the width under the
  floating scoreboard band, the tray below. The band inset is measured at
  the bottom of the chips, clock and menu (not the topbar's fade padding)
  and kept as a high-water mark per match. The hand row is `--hand-w`: the
  screen's width, at most 560px, and short enough that a card is at most 16%
  of the screen's height. Tablets and short phones (`min-width: 600px` or
  `min-aspect-ratio: 47/100`) get a one-row band; under 600px it shows only
  the opponent's name (as much as fits), the clock loses its "TIME LEFT"
  caption and overtime shows OVERTIME over the time, so the row always fits
  and keeps its height. King and the chat bubble sit small and low on the
  tray's edge, over the board's near corners; the canvas's no-op click
  listener keeps the browser's touch adjustment from pulling taps on the
  board beside them onto them.
- Menus: the column is `min(100vw, max(52vh, 420px))`, so landscape phones
  get a usable home screen. Between battles the HUD keeps its layout but is
  hidden: its floating Next, King and chat would show through the home
  screen's window onto the arena.
- Narrow side panels (under 240px) tighten the clock, and in overtime show
  OVERTIME over the time instead of "TIME LEFT", so the menu stays in the
  panel.
- Wide extras: the card tooltip opens beside the panel, the emote tray opens
  sideways (never over King), the online RTT pip follows the left panel, the
  sandbox and replay buttons sit mid-height in the left panel, the
  tutorial coach docks at the screen's top or bottom over the board, and a
  soft edge shade (ending where the board's column starts) hides the bare
  world past the stands in some arenas.
- King is `position: fixed` inside `#hud` in wide mode: never put a
  `transform` or `filter` on `#app` or `#hud`.

## Cost

A full-screen desktop battle draws ~4x the pixels of the old column.
`renderDpr()` (post.ts) caps a battle frame at 2.6M device pixels, never
below 1 device px per CSS px: phones are unchanged, a 1440x900 retina screen
renders at 1.42x. The hand's card art is drawn at 136 CSS px (was 72) so the
bigger panel cards stay sharp.

Measured with `tools/perf-budget.mjs`: draw calls are unchanged on a phone
(390x844@2: 154 empty / 380 fight) and the same at 1440x900@2 (154 / 377).
The phone canvas also stopped rendering a stretched 780x1512 backing store
for its 780x1306 box (the old tray bug), so phones draw ~14% fewer pixels in
battle. Software-GL frame time at 1440x900@2 rose in step with the pixels
(1.5M -> 2.6M); real GPUs need a check on the family's actual laptop.

## Sizes (CSS px per tile, before -> after)

| Viewport | Mode | Tile | Hand card width |
|---|---|---|---|
| 390x844 phone | tall | 19.6 -> 21.1 | 84 |
| 360x740 phone | tall, one-row band | 17.2 -> 18.7 | 76 |
| 375x667 iPhone SE | tall, one-row band | 14.7 -> 15.8 | 80 |
| 820x1180 iPad Air | tall, one-row band | 30.5 -> 32.6 | 136 -> 126 |
| 568x320 iPhone SE landscape | wide (176px panels) | 5.7 -> 10.1 | 59, 2x2 |
| 667x375 landscape phone | wide | 7.0 -> 14.0 | 64, 2x2 |
| 844x390 landscape phone | wide | 7.3 -> 14.6 | 85, 2x2 |
| 800x600 window | wide (176px panels) | 12.6 -> 21.7 | 68, one column |
| 850x700 window | wide (176px panels) | 15.7 -> 24.2 | 87, one column |
| 1000x1000 window | wide (176px panels) | 24.9 -> 31.8 | 130, one column |
| 1024x768 | wide | 17.8 -> 28.7 | 99, one column |
| 1180x820 iPad landscape | wide | 19.4 -> 30.6 | 110, 2x2 |
| 1440x900 desktop | wide | 21.9 -> 33.6 | 131, 2x2 |
| 1920x1080 | wide | 27.4 -> 40.3 | 131, 2x2 |

Verify with `node tools/visual-sheet.mjs --view 1440x900` (or any WxH[@dpr])
and `node tools/perf-budget.mjs --view 1440x900@2`; in the dev build
`__cr.layout()` and `__cr.fieldRect()` report the mode, framing and the
board's on-screen rectangle.
