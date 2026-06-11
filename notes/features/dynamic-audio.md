# Dynamic audio pass

## Changes

- Music intensity levels (0 normal / 1 double elixir / 2 overtime):
  the 16-step loop retimes live (`MUSIC_STEP_MS = [220, 190, 160]`)
  and layers percussion — closed-hat noise at ≥1, a deep kick every
  4 steps at ≥2. `main.ts` drives `setIntensity` from battle state
  each frame and resets it on restart.
- Deploy sounds scale with card cost (`deployPitch`): a P.E.K.K.A
  lands with a long deep thump, skeletons with a light tick.
- A balloon's death bomb now booms like a fireball instead of the
  generic troop death blip.
- SoundEngine stays constructible without AudioContext, so the pure
  state logic (intensity, pitch mapping) is unit-tested in
  sound.test.ts.
