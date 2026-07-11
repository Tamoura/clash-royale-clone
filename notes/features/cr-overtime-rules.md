# CR-accurate overtime (research round)

Researched real CR rules (fandom wiki via search):
- Overtime is 2 minutes (was 3, changed Nov 2019); last overtime
  minute runs TRIPLE elixir; tiebreak = lowest tower HP (we already
  match); king activation rules match ours.
- Our elixir economy already matched exactly (2.8s/elixir, start 5,
  max 10).

Changes:
- OVERTIME_DURATION 60 -> 120.
- New tested elixirMultiplier(state): 1x / 2x (last regular minute +
  first OT minute) / 3x (final OT minute); tickElixir now takes the
  multiplier; isDoubleElixir kept for HUD/music (mult >= 2).
