# Card balance tweaks (user)

- P.E.K.K.A: maxHp 3000 -> 2900, damage 750 -> 650 (-100 each).
- Balloon death bomb: requirement = half a normal hit. Already
  deathDamage 300 = damage 600 / 2; now locked by a test
  (deathDamage === damage/2). Both scale by the same level mult, so
  it stays half at every card level.
