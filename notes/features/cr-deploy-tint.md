# CR match: deploy zone tint

> **Superseded by [placement-zone.md](placement-zone.md).** The dark enemy
> half and the blue own-half glow below were replaced by one exact deploy
> map (outline, lit pocket, ink stripes, the King's keep-clear bite) drawn on
> a single plane by `src/render3d/scene/deployOverlay.ts`. Kept for history.

- While a troop card is selected, the enemy half now darkens with a
  translucent near-black overlay (CR's "can't place here" read),
  alongside the existing subtle blue glow on the own half.
- Both planes toggle through setZoneVisible.
- Verified in browser with the knight selected.
