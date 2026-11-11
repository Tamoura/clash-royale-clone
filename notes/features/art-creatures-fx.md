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
