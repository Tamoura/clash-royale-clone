# Early look rounds (June 2026)

The first art rounds gave the battle a bright, readable toy-arena look, one
small round at a time. This note keeps what each round built. Later passes
replaced most of it: see `art-direction-2026-11.md`, `art-stage.md`,
`art-towers.md`, `art-cast-kit.md` and `placement-zone.md`.

## Arena

- **Ground.** One slab with a two-green checker grass top: a canvas texture
  with one pixel per tile (NearestFilter for crisp edges), and pale stone
  edging rails with chunky corner posts. (Classic later dropped the checker.)
- **River and bridges.** A canvas water texture with white light streaks
  that scrolls slowly (waterTex offset driven in render()); plank bridge
  decks with seams and nail dots, rails with end posts. Later the planks
  turned golden (base #e0b04f, seams #c2913a, dark knots, sun-bleached
  flecks) with warm rails (0xb8893a) and dark posts.
- **Lane paths.** The faint white lane stripes became sandy-gold dirt paths:
  one strip per bridge, full field length, soft alpha edges, wear speckles.
- **Dressing.** A 140x140 distant ground plane fading into the fog, so the
  arena no longer floats in a void; a fence ring around the apron;
  team-coloured tents with pennants at the corners; torch posts at each
  bridge approach.
- **Stands and crowd.** Stone galleries with pitched roofs and gold ridge
  lines flank both halves (red roofs on the enemy half, blue on the
  player's), outside the fence. Each seats a row of low-poly spectators
  (cone body, skin-tone head) with deterministic placement and a slight
  stagger; the roof was raised 0.2 to clear the heads.
- **Floor emblem.** A flat gold emblem per half at z = ±(ARENA_HEIGHT/4 +
  0.5). Since replaced: Classic paints a faint crown watermark into the
  floor, and the Golden Age floor has a ten-fold rosette.
- **Grading.** ACESFilmic tone mapping at 1.18 exposure; background and fog
  in daylight sky blue (0x76aede).
- **Camera.** A steep ~66 degree view (CAM_HOME (0, 36, 17), lookAt (0, 0,
  1), fov 48), chosen by a grid search over projected arena corners and
  stand tops. BAR_TILT derives from CAM_HOME so HP pills face the camera.
  `winter-stone-arena.md` and `portrait-topdown.md` changed it later.

## Towers

- Square stone keeps: brick texture walls, a wider plinth, a gold trim band
  under the battlements, merlons along the roof edges, a door and a hanging
  team banner on the face toward the enemy.
- A two-step platform under each (wide pale slab, gold trim line), and a
  golden three-spike crown emblem on the king's platform.
- HP pills: makeHpBar draws a rounded dark trough with an inset coloured
  fill and a gloss highlight; tower HP sits inside the pill with a
  team-colour level badge at the end.

## HUD

- **Cards.** Gold and orange frames on a royal-blue gradient, dark-outlined
  names, a hover and selected lift with a golden glow; locked cards
  desaturate. The cost badge sits top left. The panel is a navy gradient
  with a raised top border, and the next-card slot a framed well.
- **Resource bar** (the Sparks bar; the code calls it the elixir bar). The
  counter leads the bar; the fill is a vertical gradient with a white top
  highlight, under ten segment ticks drawn with a repeating gradient. Its
  colour moved from purple to pink (#f23aa8 / #ff7ac6 / #c01878).
- **Top bar.** Player and opponent banners (blue and red gradients) with
  round level badges and crown counts. The clock sits in a gold-framed navy
  box with a small "TIME LEFT" caption above gold digits; overtime turns it
  red.
- **Deploy tint.** Superseded by `placement-zone.md`.
- **Typography.** A chunky rounded system font stack (Chalkboard SE, Marker
  Felt, Comic Sans MS, then Trebuchet) with text strokes and layered drop
  shadows; the canvas sprites used the same stack. The game now ships Lilita
  One and Baloo Bhaijaan 2 (OFL).

## Characters

- A details pass on the early procedural troops: the Knight's moustache
  blond; the Musketeer a steel helmet with a team feather and a shoulder
  pad; the Witch a violet hood, white hair and a horned staff; the Prince a
  goatee, a raised visor and a team plume; the Gargoyles a blue-grey skin.
  The cast-kit models replaced these figures later (`art-cast-kit.md`).
