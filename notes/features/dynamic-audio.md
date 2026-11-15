# Dynamic audio pass

## Changes

- Music intensity levels (0 normal / 1 double elixir / 2 overtime):
  `main.ts` drives `setIntensity` from battle state each frame and
  resets it on restart. The battle track is now War Drums (see
  `war-drums.md`). Its drums play from the first beat at every level.
  Double elixir adds answering drums, hats or riq jingles and a second
  horn. Overtime adds rolls and a faster tempo: steps of 230, 215 and
  195 ms (`MUSIC_STEP_MS`). This replaces the 16-step loop, which added
  hats at 1 and a kick at 2.
- Deploy sounds scale with card cost (`deployPitch`): a P.E.K.K.A
  lands with a long deep thump, skeletons with a light tick.
- A balloon's death bomb now booms like a fireball instead of the
  generic troop death blip.
- SoundEngine stays constructible without AudioContext, so the pure
  state logic (intensity, pitch mapping) is unit-tested in
  sound.test.ts.
