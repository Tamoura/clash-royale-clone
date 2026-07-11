# Tower destruction spectacle

## Changes

- New sim event `king-wake` (side), emitted exactly once on the
  inactive→active transition (damage-wake or princess-fall-wake);
  unit-tested in events.test.ts.
- Renderer: falling crown towers now drop a persistent rubble pile
  (cleared on restart), kick a decaying camera shake (stronger for
  the king), and the king's awakening fires a red shockwave ring +
  angry steam puffs + its own shake.
- Audio: low war-horn blast on king-wake.

Camera home position is (0, 24, 27) — shake jitters around it and
snaps back when spent; reset() also restores it.
