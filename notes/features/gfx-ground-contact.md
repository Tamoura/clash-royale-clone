# Graphics: ground contact

- Flyers (dragon, gargoyles, balloon) get a soft blob shadow that
  shrinks as they bob upward — `blobShadowScale` is pure and tested
  (clamped 0.55..1.3 so it never vanishes or balloons).
- Walking ground troops kick up small dust puffs every
  DUST_INTERVAL (0.45s), skipped while stunned or fighting; first
  puff is randomly offset so columns don't stomp in sync.
