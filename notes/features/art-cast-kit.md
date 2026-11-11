# Art package: cast-kit

Modelled cast for "Toy Tournament" (see notes/features/art-direction-2026-11.md, ### cast-kit).
Branch art/cast-kit from art/base (b7ae4ce). Worktree /home/user/wt-art-cast-kit, dev server port 3201.

## Perf (tools/perf-budget.mjs, 390x844@2, quality=high, first arena)

| When | Edition | Empty calls / tris | Fight calls / tris | Fight textures |
|---|---|---|---|---|
| Start (art/base) | Classic | 178 / 266,074 | 431 / 769,750 | 49 |
| Start (art/base) | Golden Age | 167 / 137,566 | 399 / 509,370 | 49 |

## Decisions

- Lean: the body tips about its feet so its front/back turns toward the camera (head away from the
  viewer, a partial billboard): the opposite sign shows MORE hat-top, which is what the critics hated.
- Team colour is two shared uniforms per side (TEAM_UNIFORMS), not baked into atlases: one atlas and
  one geometry per card and edition serve both teams, and a palette switch repaints live units.
- Ink on the cast is silhouette-only: the shell sits 0.3 world units behind the body along the view,
  so hat folds and hood seams no longer draw "V" marks. 1.6 CSS px.
- Team rule test runs on the DEFAULT palette's two hues (blue ~217 deg, red ~1 deg). The colour-blind
  orange (32 deg) would forbid every gold, wood and skin tone; colour-blind players read the side
  from the notched disc and the cloth, as before.
- The old opt-in path is gone: public/models/kaykit (11 MB), glbModels.ts, modelsOptIn.ts and the
  orphan dev page viewer.html + src/viewer.ts (it only loaded public/models/kaykit). Not in the
  package's owned list, but it imported the deleted glbModels.ts and nobody else touches it.
- Troop pack: gltfpack -cc -kn -km -vpf -vtf (float positions and UVs, the bake reads them raw).

## Variant table

## Screenshots

## Known gaps

## Requests for ship

1. src/render3d/scene/fx/cardwaveFx.test.ts (creatures-fx owns it): the test "troops keep their one-frame
   white snap and warm fade" pins the old white hit flash the art bible forbids. The game no longer uses it:
   troops flash through `troopFlashTint` (animate.ts, peak 0.35 toward #FFF4E0, 80 ms). Replace that test with
   `expect(Math.max(...troopFlashTint(FLASH_TIME, out))).toBeLessThanOrEqual(0.35)` and then delete the
   legacy troop branch of `hitFlashTint` (LEGACY_FLASH_TIME / LEGACY_FLASH_WARM) in animate.ts.

## Progress log

- Worktree created from art/base; B's troop files checked out from proto/kit-everything
  (kitTroops.ts, troop-pack.mjs, troopview.html, public/models/troops, cardportraits.ts, animate.ts, common.ts).
  Start perf measured (table above).
- Cast module split into src/render3d/cast/ (types, loader, bake, rules, props, unit, animate, crew,
  variants.classic, variants.golden (empty yet), palettes, index); kitTroops.ts re-exports it.
  troops.ts ported (kit path under a LEAN node, no name tags, damage-only outlined team HP bars, kit ghost,
  one shadow caster per unit), animate.ts drives the cast (ground-speed walk, Hit_A, Death_A), capped flash.
  Lean sign: the body tips so its front/back turns toward the camera (head away from the viewer).
- Starter-deck variants tuned by eye on the contact sheet (heights in band, giant stretched taller with a
  smaller head and a beard under the chin, hat/hood "V" marks removed with hairBack, witch hair box dropped).
  Team discs thicker (ring from r*0.5) and more saturated (discColor). Troop flash capped (troopFlashTint).
  troops.test.ts updated for damage-only bars. vitest + tsc green.
