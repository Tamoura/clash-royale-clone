# Feature: animation-polish

Branch: `feature/animation-polish` (stacked on
`feature/more-cards-and-gameplay`)

User asks: (1) swarms "dying alone" — bot was insta-spelling 3-unit
swarms on deploy; (2) archer attacks invisible; (3) world-class
character design + animation.

## What changed

- **Bot**: cluster spells now require the cluster's elixir value to
  exceed the spell cost (`unitValue` = card cost / count).
- **Cel shading**: all materials are MeshToonMaterial with a shared
  3-step gradient (`toon()` in characters3d, reused by scene3d).
- **Rig system**: legs are hip-pivot groups (alternating swing),
  `offArm` counter-sways, wings flap, weapon arm swings + body lunge.
  Walk hop has squash & stretch; idle has breathing.
- **Design pass**: sphere heads with bead eyes for organic
  characters, shoulder pads + shield for knight, quiver + nocked
  arrow for archer, flared coat for musketeer, cute-eyed dragon,
  bat-eared gargoyles, braided valkyrie with double-disc axe,
  prince's pony with mane/tail/saddle (4 galloping legs).
- **Scene animation**: spawn pop-in (easeOutBack), white damage
  flash (emissive, originals restored), smooth shortest-arc turning,
  death animations (troops topple + fade, towers sink; label
  sprites are HIDDEN not faded — their materials are shared).
- **Projectiles**: real arrow meshes (shaft + tip, oriented, arced)
  for archers/towers, musket balls, glowing wizard/dragon orbs,
  arcing cannonballs.
- **Spell theatre**: fireball is a falling meteor + explosion + ground
  ring; arrows are a 10-missile volley raining over the radius.
  Effects support a `delay` so impacts chain after the falling phase.

## Gotchas

- Name-label SpriteMaterials are cached per card+side and SHARED —
  never fade them (hide instead) or all same-type units vanish.
- `sync(state, dt)` now needs dt (turn smoothing, pop, flash).
- The white ground disc seen in screenshots is the deploy hover
  indicator, not a bug.
