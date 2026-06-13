# Winter stone arena + flatter camera (from CR screenshots)

User: real CR arenas are stone-tile with snow, and the board
should be flat in the screen like the first version.

- Floor: makeGrassTexture rewritten as sandy stone tiles (32px/
  unit, 2-unit beige blocks with per-tile shade, grit speckle,
  mortar grid). Slab sides + edging recolored to snowy stone.
- Snow: makeSnowDrift (half-sphere mounds) scattered along all
  four playfield edges; apron + distant ground turned snow-white;
  sky/fog shifted to icy blue (0x9ec8e8).
- Camera: CAM_HOME 36,17 -> 25,26 (lookAt z 1.0 -> 1.5) — back to
  the first version's flatter ~43deg framing so the arena reads as
  a flat board filling the screen. BAR_TILT auto-derives.
