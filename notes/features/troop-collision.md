# Troop collision (realism round 1)

User picked collision from the "make it real" menu.

- resolveCollisions in sim.ts: O(n^2) pairwise soft separation,
  2 relaxation passes per tick (30Hz, ~40 entities max — cheap).
- Rules: troops shove troops (bigger radius shoves smaller via the
  share split), buildings/towers are immovable, air and ground are
  separate planes (flying !== flying skips). 0.9 slack lets crowds
  squeeze slightly like CR. Deterministic stacked-spawn nudge keyed
  off entity ids (no randomness; bot determinism test still holds).
- Runs after the act loop, before deaths.
