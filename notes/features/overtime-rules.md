# Overtime rules

- Overtime is 2 minutes. The last regular minute and the first overtime
  minute run double elixir (Sparks on screen); the final overtime minute
  runs triple. If crowns are still tied, the lowest tower HP decides
  (`tiebreaker.md`). The King tower wakes when it is hit or a side tower
  falls.
- Economy: 2.8 s per elixir, start 5, max 10.

Changes in this round:
- OVERTIME_DURATION 60 -> 120.
- New tested elixirMultiplier(state): 1x / 2x (last regular minute +
  first OT minute) / 3x (final OT minute); tickElixir now takes the
  multiplier; isDoubleElixir kept for HUD/music (mult >= 2).
