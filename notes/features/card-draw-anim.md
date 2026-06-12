# Card draw animation

- When a hand slot's card changes (cycle after a play), the new
  card pops up from below with an overshoot ease (CR's deal feel).
  Detected per-slot in hud.update via dataset.card diff; animation
  restarted with an offsetWidth reflow.
