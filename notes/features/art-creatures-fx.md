# Art package: creatures-fx

Creatures, card buildings and every effect in the KayKit cast's material language, both editions.
Spec: `notes/features/art-direction-2026-11.md` (### creatures-fx, Art bible sections 5, 7, 8).
Branch `art/creatures-fx` from `art/base` (b7ae4ce). Worktree `/home/user/wt-art-creatures-fx`, dev port 3202.

## Perf budget

Measured with `node tools/perf-budget.mjs --url http://127.0.0.1:3202 [--edition arabic]` (390x844@2, quality=high, first arena).

| When | Edition | Empty calls | Empty tris | Fight calls | Fight tris | Fight textures |
|---|---|---|---|---|---|---|
| start (b7ae4ce) | classic | 178 | 266,074 | 435 | 769,710 | 49 |
| start (b7ae4ce) | golden | 167 | 137,566 | 399 | 509,394 | 49 |

Package ceiling: fight calls <= base + 10 (classic 445, golden 409); fight triangles <= base + 5% (classic 808k, golden 535k).

## Progress log

- Worktree created from art/base; perf base recorded (table above).
- 5d19b43 Damage numbers: gold #FFD23F fill, 3 px #1D1630 stroke, soft drop shadow (three-mask glyph atlas), crits and tower hits 1.3x, same-target hits within 150 ms merge, overlapping numbers stack (stackLift).
- 33d366d FX: presets re-authored for the bloom contract (only cores/sparks above hdr 1; rings, puffs, flames in the alpha pool), outlined toon smoke tinted by floor (floorDust from LOOK) or effect colour, 4-6 inked star sparks, 3-tone toon flames, fireball = hot core + 3 petals + smoke ribbon (spell and projectile, no cone), fletched arrows (mesh and volley sprite), musket tracer, electric bolt, ice shard; two-tone team ring decal at every spell's true radius (spellRing), team deploy burst, tinted deaths, screen flash capped 0.25 (FX_MAX_FLASH). Rig material language on baked rigs (ramp/rim/AO/silhouette ink 1.6 px/mix tints), glow parts under luminance 0.8.
- 7da480f + 6fb5376 Creatures: one team slot each (both editions), bake-time albedo grade, golem rune glows, card buildings as bakeable rigs (buildBuildingRig), slimmer war elephant (ELEPHANT_SCALE), feathered/membrane wings, tools/creatureview.html sheet; tests for slots, palette, glow, buildings.
- NEXT: in-battle looks (phone), FX sheet + creature sheet files in /tmp/claude-0/art/creatures-fx/, hitstop/shake retune, perf, matrix, Requests for ship.
