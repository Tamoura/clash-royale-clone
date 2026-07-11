# Fix: clamp troop positions to the arena

## Problem
Found via a 300-game bot-vs-bot self-play stress harness: nothing kept
troops inside the field. The Firecracker's recoil (it kicks itself
backward after each shot) could push it several tiles off the board —
seen at x = -3.7 (arena is x ∈ [0,18]) and y = 32.9 (past its own back
line). Collision shoving near a wall also nudged units (e.g. Knight)
half a tile past the edge.

## Fix
`clampToArena(state)` in `sim.ts`, called each tick after
`resolveCollisions`. It pens every troop's body inside the field:
`x ∈ [radius, ARENA_WIDTH - radius]`, `y ∈ [radius, ARENA_HEIGHT - radius]`.
Towers/buildings don't move and are placed in bounds, so only troops
need it.

## Test
`mechanics.test.ts` › recoil › "recoil never kicks a unit off the edge
of the arena": a Firecracker pinned at the left wall firing right must
stay within [0, ARENA_WIDTH] / [0, ARENA_HEIGHT] after several shots.

## Self-play harness findings (otherwise clean)
No NaN, no hp>maxHp, no elixir out of range, no infinite games, no
crown/winner mismatches, bounded entity/projectile counts. The only
invariant violation was the off-board recoil fixed here.
