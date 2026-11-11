# Art package "stage" (Toy Tournament, wave 1)

Spec: notes/features/art-direction-2026-11.md, "### stage". Branch art/stage from art/base (b7ae4ce),
worktree /home/user/wt-art-stage, dev server port 3204.

## Perf at start (art/base b7ae4ce, ?quality=high, first arena)

| View | Edition | Empty calls / tris | Fight calls / tris |
|---|---|---|---|
| 390x844@2 | Classic | 178 / 266,074 | 435 / 769,710 |
| 390x844@2 | Golden Age | 167 / 137,566 | 402 / 509,438 |
| 1440x900@1 | Classic | 176 / 266,048 | 433 / 769,692 |
| 1440x900@1 | Golden Age | 167 / 137,566 | 399 / 509,382 |

Golden Age at start has no dynamic troop shadows (C's `!ARABIC` gate).

Start shots: /tmp/claude-0/art/stage/start/.

## Decisions

(filled in as work lands)

## Requests for ship

(none yet)

## Known gaps

(filled in at the end)

## Progress log

- Start: worktree created from art/base, perf measured (above), start shots taken.
