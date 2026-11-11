# Art package: cast-kit

Modelled cast for "Toy Tournament" (see notes/features/art-direction-2026-11.md, ### cast-kit).
Branch art/cast-kit from art/base (b7ae4ce). Worktree /home/user/wt-art-cast-kit, dev server port 3201.

## Perf (tools/perf-budget.mjs, 390x844@2, quality=high, first arena)

| When | Edition | Empty calls / tris | Fight calls / tris | Fight textures |
|---|---|---|---|---|
| Start (art/base) | Classic | 178 / 266,074 | 431 / 769,750 | 49 |
| Start (art/base) | Golden Age | 167 / 137,566 | 399 / 509,370 | 49 |

## Decisions

## Variant table

## Screenshots

## Known gaps

## Requests for ship

## Progress log

- Worktree created from art/base; B's troop files checked out from proto/kit-everything
  (kitTroops.ts, troop-pack.mjs, troopview.html, public/models/troops, cardportraits.ts, animate.ts, common.ts).
  Start perf measured (table above).
- Cast module split into src/render3d/cast/ (types, loader, bake, rules, props, unit, animate, crew,
  variants.classic, variants.golden (empty yet), palettes, index); kitTroops.ts re-exports it.
  troops.ts ported (kit path under a LEAN node, no name tags, damage-only outlined team HP bars, kit ghost,
  one shadow caster per unit), animate.ts drives the cast (ground-speed walk, Hit_A, Death_A), capped flash.
  Lean sign: the body tips so its front/back turns toward the camera (head away from the viewer).
