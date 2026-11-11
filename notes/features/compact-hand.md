# Compact hand: the cards give their room to the arena

The owner's words: "cards are taking more room from arena room". They were
right. On a phone the tray was 191px of an 844px screen (22.7%, and 28% on a
short phone), the Next card, the chat bubble and KING floated over the bottom
of the board, and on a laptop the hand was a 296x487px panel of 131px cards
beside a 604px board (at 1024x768 a column of cards the whole height of the
screen). This round makes the hand a thin strip and hands everything it gives
up to the board. Nothing under `src/game/` changed.

## What it looks like now

**Tall layout (phones, portrait tablets): one compact tray.**

```
(6)==========------------      slim elixir rail on the tray's top edge
[Next] [c1] [c2] [c3] [c4] (KING)
[chat]                         one row, nothing floats over the board
```

- The elixir bar is a 16px rail along the tray's top edge with a 28px droplet
  (the number) at its start and the x2 tag at its end. It still shakes when a
  play needs more elixir, and pulses at 10.
- Next is a mini card at the row's start (its label a tab on its bottom
  edge), with the chat bubble under it; KING is the round button at the
  row's end. All three were floating over deployable tiles before.
- Cards are 4:5 (were 3:4), their art zoomed in on the character
  (`HAND_ART_ZOOM`), the cost droplet 24px at the bottom edge. No caption on
  the art any more: on laptops the cost droplet sat on top of it; the hover
  tip and the long-press bubble name the card.
- The "+N elixir needed" badge sits midway down the card (2px over the
  middle), between the level chip on the top corner and the cost droplet's
  tip. At the card's top (where it was) the "Lv.11" chip covered it on the
  smaller cards, and hid it almost entirely with the large text setting.
  The tall tray's chip also stops growing at 13px with that setting, so the
  three stay apart from 300px wide up; on a 280px cover screen with large
  text they touch at the edges but all three still read.
- The edition's ornament stays on the tray's top frame (Golden Age's gold
  star and seal, Classic's diamonds), above the rail; the wide panel has
  none, as before.
- Under 299px wide (a foldable's 280px cover screen) the tray's gutters and
  gaps give way, only as far as four 44px cards need (`--gutter-w`,
  `--gap-w`): 280x653 gets 44px cards (56px before this work, 39px without
  the squeeze). Below about 274px nothing is promised.
- A picked or dragged card lifts out of the tray, over the rail.
- The long-press bubble opens right above the tray (it used to clear the
  floating controls, 64px up); the emote faces open above the tray's start.

**Wide layout (landscape, laptops, desktops): a small card block.**

- The hand is a 2x2 block; cards are capped by the screen's height
  (`wideCardCap`: 11.5% of it, 72 to 112px), so the panel is only as wide as
  two such cards (`sideMax`). One screen-high column of cards is now the
  exception: it must give cards a third bigger than the 2x2 (`ONE_COLUMN`).
- Thinner chrome (2px border, 12/10px padding, 16px row gap), a slightly
  more see-through panel.
- Side panels may go down to 144px (were 176px): near-square and small
  landscape windows give that width to the board. Under 176px
  (`:root[data-slim]`) the left panel's clock drops its "TIME LEFT" caption
  and its row takes the column's inner 12px with a 40px menu button, so
  OVERTIME and the menu still sit side by side inside the column.
- KING and the chat bubble stay bottom-left in the left panel.

**The frame.** A width-bound phone cannot draw a bigger board (the field
already spans the screen), so the slimmer tray leaves height over: 62px at
390x844, 97px at 412x915. `fitBattleFrustum` takes an `alignY` for that
slack and the tall layout uses `TALL_ALIGN_Y = 0.6`: three fifths of it go
above the board (the far towers and their HP pills stand clear of the
scoreboard, the far stands and the castle show), the rest under the player's
side. Where the board fills the free height (short phones, tablets, side
panels) `alignY` changes nothing.

## Sizes (measured in the browser, before -> after)

`__cr.fieldRect()` is the 18x32 tile field on screen; "tile" is its width / 18.

| Viewport | Layout | Tray or panel | Share of height | Hand card | Field (px) | px per tile | Field rect after (x, y) |
|---|---|---|---|---|---|---|---|
| 360x640 | tall | 181 -> 111 tall | 28.3% -> 17.3% | 76x99 -> 56x69 | 269x362 -> 317x426 | 14.96 -> 17.61 (+18%) | 21, 92 |
| 375x667 | tall | 186 -> 111 tall | 27.9% -> 16.6% | 80x104 -> 56x69 | 284x381 -> 335x450 | 15.78 -> 18.62 (+18%) | 20, 94 |
| 390x844 | tall | 191 -> 124 tall | 22.7% -> 14.7% | 84x109 -> 67x82 | 380x510 -> 380x510 | 21.08 (width-bound) | 5, 165 (was 6, 127) |
| 412x915 | tall | 199 -> 131 tall | 21.7% -> 14.3% | 89x117 -> 72x89 | 401x539 -> 401x539 | 22.27 (width-bound) | 6, 188 (was 6, 144) |
| 768x1024 | tall | 246 -> 144 tall | 24.0% -> 14.1% | 124x164 -> 83x102 | 484x650 -> 552x741 | 26.87 -> 30.67 (+14%) | 108, 117 |
| 820x1180 | tall | 248 -> 160 tall | 21.0% -> 13.6% | 126x166 -> 96x118 | 587x789 -> 646x868 | 32.61 -> 35.89 (+10%) | 87, 127 |
| 844x390 | wide | 245x364 -> 174x311 panel | | 85x111 -> 72x89 | 262x352 (height-bound) | 14.55 | 291, 28 |
| 1024x768 | wide | 194x739 -> 194x336 panel | | 99x130 -> 82x101 | 516x693 (height-bound) | 28.66 | 254, 55 |
| 1366x768 | wide | 296x487 -> 207x351 panel | | 131x173 -> 88x109 | 516x693 (height-bound) | 28.66 | 425, 55 |
| 1440x900 | wide | 296x487 -> 237x363 panel | | 131x173 -> 103x127 | 605x812 (height-bound) | 33.58 | 418, 64 |
| 1920x1080 | wide | 296x487 -> 254x385 panel | | 131x173 -> 112x139 | 725x975 (height-bound) | 40.30 | 597, 77 |

Honest reading of the table:

- Short phones and tablets were height-bound, so the board itself grows
  10 to 18%.
- 390x844 and 412x915 were already width-bound: the board is the same size.
  What they gain is 67px more arena on screen, a board that no longer sits
  under the scoreboard, and no HUD element over a tile (Next, chat and KING
  covered 2086 + 1298 + 1265 px2 of the field at 390x844; now 0).
- On every wide screen in the list the board already filled the screen's
  height, so it cannot grow; the hand beside it shrank by 40 to 55% in area.
  The task brief expected 844x390 and 1024x768 to be panel-bound; measured,
  they are not (the old panels had 269px and 218px of room). The windows that
  were panel-bound do grow: 568x320 +19%, 800x600 +3%, 900x900 +12%,
  1000x1000 +10%, a foldable's 884x768 +10% (`layout.test.ts`).
- 360x640 and 375x667 land at 17.3% and 16.6% of the height, a little over
  the 16% target: their cards stop at the 56px floor (`TALL_CARD_MIN`), which
  matters more for a kid's finger than the last 6px of board. The chrome
  around the cards (42px: frame, rail, gaps, the padding the cost droplets
  hang into) would have to drop to 34px for 16% at 360x640, which puts the
  28px elixir droplet on the Next card and the cost droplets on the screen's
  edge, for a board 1.7% bigger. Not worth it.
- Small landscape windows that were panel-bound pay for their bigger board
  with smaller cards: 640x480 draws a board 23% bigger with 45px cards (were
  59px), 568x320 19% bigger with 51px cards. Still above the 44px touch
  minimum; real landscape phones (640x360 to 932x430) get 62 to 72px cards.

## How it is built

- `src/ui/layout.ts` is still the one place the sizes come from. New in the
  result: `cardH`, `nextW`, `kingW`, `gutter`, `gap`, `tray`. Tall: cards are
  `min(by width, max(56px, 10% of the height), 96px)`; Next and KING keep
  36px and 46px columns on phones and grow with the cards where there is
  width to spare (tablets). `trayHeight()` is what the camera is promised.
  Wide: `wideCardCap`, `sideMax`, `SIDE_MIN = 144`, and the arrangement score
  (bigger cards, a readable elixir bar, the 2x2 block over a column).
- `src/ui/layoutWire.ts` sets `--card-w`, `--card-h`, `--next-w`, `--king-w`,
  `--gutter-w`, `--gap-w` (tall), `--band` (tall: the measured scoreboard band) and `data-slim` next
  to the old variables, and clears them all between battles, when the tray
  falls back to a phone's sizes (it keeps its layout under the home screen,
  hidden; the home diorama fits itself to the stage it is given, so the home
  screen looks the same).
- `src/ui/styles/hud.css`: the tray's base rules are the tall layout's (a
  grid: the rail row, then `next | hand | king`); the wide layout overrides
  them into the side panel. The numbers `layout.ts` relies on are marked in
  comments on both sides, and `layoutCss.test.ts` reads them back out of the
  stylesheet and checks them against `layout.ts`.
- `src/render3d/hud.ts`: card art takes an aspect and a zoom; the chat bubble
  (`#emotes`, built by `main.ts` in the stage) is moved into the tray so the
  grid can place it; the caption element is gone.
- `src/render3d/scene/fit.ts` + `camera.ts`: `alignY` in the fit and in
  `Framing`.
- Wide: KING and the chat bubble are `position: fixed` inside `#hud`, so
  never put a `transform` or `filter` on `#app` or `#hud` (as before).

## Cost

- Draw calls are unchanged (`tools/perf-budget.mjs`, 390x844@2: 154 empty /
  376 fight, was 154 / 377).
- The phone's canvas is taller (390x844: 653 -> 720 CSS px), so a phone
  shades about 10% more pixels per frame. Tall phones from about 400px wide
  (412x915: 412x784 @2 = 1.29M device px) now cross `BLOOM_HALF_PX` (1.2M)
  and get the half-size bloom the 430px phones already had; 390x844 and
  393x852 stay under it. Worth a look on the family's real phones.
- The hand's card art is drawn at 112 CSS px (was 136).

## Things that depend on the tray (all re-checked in a browser)

- Tap-tap and drag deploys land on the tile under the finger at 360x640,
  390x844, 768x1024, 844x390 and (mouse) 1440x900 and 1024x768, both
  editions, including the near corner tiles right above the tray, which no
  HUD element covers any more.
- Long-press info bubble, card deal and Next slide animations, the "+N"
  badges and the rail's shake without elixir, the x2 tag, KING (charging
  bubble, ready pulse, firing), the emote tray (44px faces, on screen).
- Tutorial: the card-to-tile demo, the elixir callout (the ring is around the
  rail now), the KING callout, and the coach bubble, which docks 8px above
  the tray in free play (it used to stand clear of the floating controls).
- Safe areas (emulated notch 47px, home indicator 34px, landscape 47/21px):
  the band moves under the notch, the tray's bottom padding becomes the home
  indicator's height, the side panel clears it.
- Resize and rotation mid-battle, reduced motion, the large text setting
  (the droplets' digits and the KING label are capped so they stay inside
  their shapes), RTL text in the Golden Age edition (the battle HUD itself
  stays LTR, as before), all 22 arena looks at the taller phone frame (the
  far scenery it reveals is finished in every one).
- Sandbox reset: it sat under the clock and menu in the tall layout (not
  reachable on a phone); it now goes just under the band (`--band`). Replay
  pill: unchanged.

## Tests

- `src/ui/layout.test.ts`: the old layout's maths kept verbatim as a
  reference; the board is never smaller than before on any screen
  (320..2000 x 320..1400, three safe-area sets); the acceptance screens'
  gains; tall cards never under 44px from 280px wide (56px from 360px up;
  the gutters and gaps squeeze under 299px, with no jump), tray at most
  a sixth of a phone; the row fits the width; wide hands fit their panel both
  ways and are a 2x2 on every common landscape screen; no cliff.
- `src/ui/layoutCss.test.ts`: the tray's and panel's numbers in `hud.css`
  against `layout.ts` (the gutter and gap defaults too), and the "+N" badge
  at the card's middle.
- `src/render3d/scene/fit.test.ts`: `alignY` (centred by default, clamps,
  never changes the scale, no effect when height-bound) and pointer picks at
  the new frames.

## Not done here

- For the owner: on the most common phones (390x844, 412x915) the play
  field itself is the same size as before; what they gain is more arena
  around it and no HUD over a tile. The bigger field there needs the camera
  change below.
- A width-bound phone's board can only grow with a steeper battle camera
  (about 55 degrees instead of 49 would turn the spare 60px into a field 8%
  deeper). That is a camera change across the scene modules (HP bar tilt,
  fog fit, shake, backdrop), not a layout one, and it changes how every
  character reads, so it belongs with the graphics work.
- The home screen and menus are untouched.

Verify with the dev build: `__cr.layout()`, `__cr.fieldRect()`, and
`node tools/visual-sheet.mjs --view 390x844@2` (or any WxH[@dpr]).
