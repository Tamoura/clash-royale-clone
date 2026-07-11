# Graphics: floating damage numbers

- Pure `damageLabel(dmg)` (tested): null under 25 (chip damage),
  white < 200, orange < 500 (1.45x), red >= 500 (1.9x).
- scene3d batches HP loss per entity (`pendingDmg`) and emits at
  most one popup per 0.35s per unit, so swarms and splash don't
  spam — rapid hits merge into one bigger, hotter number.
- Popup is a canvas sprite that pops in, rises, and fades.
