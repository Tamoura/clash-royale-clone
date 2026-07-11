# Sandbox / practice mode

Last unshipped Track A item from `enhancement-plan.md`: "Sandbox/practice
mode (infinite elixir, reset) (S)".

## Design decisions
- **Infinite elixir** lives in the sim as `SANDBOX_ELIXIR_RATE` (a flat
  rate so high one tick refills the bar to max). Reuses the existing
  `elixirRate` game-mode channel — no new sim state, lockstep-safe.
  A large finite number, not `Infinity`, to avoid `0 * Infinity = NaN`.
- **Dummy opponent**: the bot does not think in sandbox (like CR's
  training camp), so you can calmly try cards/interactions. Its towers
  still fight back.
- **Reset button** in the battle HUD (sandbox only) restarts instantly —
  no countdown wait.
- **No rewards**: sandbox games grant no trophies/gold/chests (can't
  farm the ladder from practice).

## Status
- [x] Sim: SANDBOX_ELIXIR_RATE keeps both bars pinned at max (tested)
- [x] Mode entry in GAME_MODES + bot skip + reward skip + reset button
- Sandbox is solo-only: LAN quick-match keeps its own mode picker and
  sandbox is excluded there (`SOLO_ONLY_MODE_IDS`).
