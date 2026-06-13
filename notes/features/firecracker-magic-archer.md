# Firecracker, Magic Archer & target persistence

Branch: `feature/firecracker-magic-archer` (stacked on `feature/online-1v1`).

## Scope (confirmed with user)

1. **Firecracker** — new troop. Full fidelity: spread **splash** + **recoil**
   (hops backward after firing). Squishy, fast, hits air.
2. **Magic Archer** — new troop. Full fidelity: **piercing** line shot that
   damages every enemy it passes through (its core identity). Longest range,
   hits air + ground.
3. **Target persistence** — once any attacker is *engaged* (target within
   attack range), it keeps hitting that target while it stays in range; a
   newly deployed nearer enemy can't pull it off.
4. Card **pool only** — add both to `DECK` (the builder pool). Leave
   `DEFAULT_DECK` unchanged.

## New engine fields

- `UnitStats.pierce: boolean` — projectile passes through all enemies in a line.
- `UnitStats.recoil: number` — tiles the shooter hops back (away from target)
  after each shot (0 = none).
- Threaded into `Entity` (set in `spawnTroops`; 0/false for towers/buildings)
  and `Projectile` (pierce shots carry `dirX/dirY/range/hitIds`).

## TDD order (each commit keeps the suite green)

- **A** — define cards + `CARD_COLOR` (exhaustive map; must add together).
  Not in `DECK` yet, so `characters3d.test` (iterates DECK) stays green.
- **B** — mechanics in `sim.ts`: target persistence, pierce, recoil.
- **C** — 3D builders (`buildFirecracker`, `buildMagicArcher`); without these
  `buildTroop` throws.
- **D** — add both to `DECK` + 2D painters; update `cards.test` DECK expectation.

## Notes

- Lockstep netcode replays inputs (not state), so new sim/projectile fields are
  safe — both clients run the identical deterministic sim.
- Projectiles are created at exactly one site: `dealDamage` in `sim.ts`.
