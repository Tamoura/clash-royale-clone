# Phase 3: match real Clash Royale (visual reference plan)

References (downloaded to /tmp/cr-ref-1.png, /tmp/cr-ref-2.png):
- https://i.redd.it/1240p6ed0s121.png (night arena, portrait, full HUD)
- https://miro.medium.com/v2/resize:fit:1340/1*UzW1QibG2-e4SqkpeArh3w.png
  (training arena: green grass, checker tiles, wooden bridges)

What CR looks like (from the refs):
- Saturated green grass with a subtle checkerboard tile pattern,
  stone-edged playfield, decorative scenery filling the frame.
- Bright blue river band, chunky wooden plank bridges with rails.
- Princess towers: square stone keeps, pointed red-tile roofs, gold
  trim. King tower wider, flat platform.
- Bottom HUD: dark navy panel; 4 big cards with gold/orange frames
  and a purple elixir-droplet cost badge; small "next" slot at left.
- Elixir bar: purple gradient with droplet icon + number, ticks.
- Top bar: name banners with level badges, crown counters, bold
  gold timer top-right.
- Chunky rounded bold typography with dark outlines everywhere.

Round plan (each = stacked branch + PR, continuing from
feature/gfx-cel-outlines):
1. cr-arena-ground: grass green + checker tiles + stone border
2. cr-river-bridges: water color/sparkle + plank bridges w/ rails
3. cr-towers: square keeps, red pointed roofs, gold trim
4. cr-hud-cards: dark panel, gold card frames, cost droplet badge
5. cr-elixir-bar: purple gradient, droplet icon, segment ticks
6. cr-top-bar: name banners, crown counters, styled timer
7. cr-deploy-tint: enemy half darkens while dragging, valid glows
8. cr-typography: chunky outlined font pass across HUD
9. cr-arena-dressing: stands/trees/fences around the field
10. cr-grading: camera + tone-mapping/saturation final pass

Status: all 10 rounds shipped (PRs #28-#37).

## 2026-06-12 self-collected reference + rounds 11-14

New ref: https://images.launchbox-app.com/2af744d3-d77c-47cc-9ca5-304a96992982.jpg
(616x810 in-battle shot, saved as /tmp/cr-ref-3.jpg). Drove:
11. cr-lane-paths (PR #38) — golden dirt lanes bridge-to-towers
12. cr-tower-platforms (PR #39) — stepped gold-trim platforms,
    king crown emblem
13. cr-spectator-stands (PR #40) — red/blue roofed galleries
14. cr-timer-box (PR #41) — gold-framed TIME LEFT clock

Remaining ideas from this ref for future rounds: tower HP bars as
colored pills with level badge, hand cards showing next-card art
larger, golden bridge planks (CR's are yellow-gold), crowd figures
in the stands.
