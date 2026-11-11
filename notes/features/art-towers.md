# Art package: towers

Branch `art/towers` (from `art/base`, b7ae4ce), worktree `/home/user/wt-art-towers`, dev port 3203.
Spec: `notes/features/art-direction-2026-11.md`, "### towers" and the art bible section 2.

Owns: `src/render3d/scene/views/towers.ts`, `towers.test.ts`, `towerCraft.ts`, `towerStyles.ts`,
`towerStyles.test.ts`, `src/render3d/towerCollapse.ts`, `towerCollapse.test.ts`, this file.

## Perf budget

`node tools/perf-budget.mjs --url http://127.0.0.1:3203 [--edition arabic]` (390x844@2, quality=high, first arena).

| When | Edition | Empty calls | Empty tris | Fight calls | Fight tris | Fight textures |
|---|---|---|---|---|---|---|
| start (b7ae4ce) | classic | 178 | 266,074 | 432 | 769,658 | 49 |
| start (b7ae4ce) | golden | 167 | 137,566 | 402 | 509,454 | 49 |

Acceptance ceilings: empty calls at most start + 6 (classic 184, golden 173, and golden at most 200);
all six towers at most 60k triangles at L0.

## Decisions

(filled in as the work lands)

## Requests for ship

(none yet)

## Progress log

- Worktree created from art/base; start perf recorded.
