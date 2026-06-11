# Feature: 3d-characters-and-sound

Branch: `feature/3d-characters-and-sound` (stacked on
`feature/character-graphics`)

Goal: 3D characters + sound, kid-friendly. Three.js low-poly
(box-built, Crossy-Road style) characters, real 3D arena with
shadows, and fully synthesized Web Audio SFX + music. Still zero
binary assets.

## Architecture

- `src/game/*` unchanged except a new `state.events: BattleEvent[]`
  stream (TDD'd): deploy / spell / attack / death / crown / finish.
  main.ts drains it each frame into the sound engine + 3D effects.
- `src/audio/sound.ts` — SoundEngine, all sounds synthesized
  (oscillators + noise buffers). Background tune is a 16-step loop.
  Throttles per-sound so skeleton swarms don't deafen. Mute button.
  AudioContext unlocks on first pointerdown (browser requirement).
- `src/render3d/characters3d.ts` — TroopRig builders (group, arm,
  armRest, swingAmp, height). Headless-testable (no renderer).
- `src/render3d/scene3d.ts` — Battle3D: arena meshes, tower meshes
  with HP-bar billboards/crown/Zz sprite, per-entity view sync,
  raycast picking, hover/zone indicators, blast/puff effects.
- `src/render3d/hud.ts` — DOM HUD (reuses 2D drawCardArt for card
  portraits). Old 2D renderer/layout deleted; characters.ts kept.

## Verification gotcha (bigger than last time)

The MCP automation window cannot create WebGL contexts at all
(`canvas.getContext('webgl2')` → null; THREE.WebGLRenderer throws).
Added a graceful fallback message for that case. Real visual/sound
check must happen in the user's own visible tab. Headless coverage
instead: rig unit tests + full sim/event suite (69 tests).

## Tuning knobs (if kids want changes)

- Camera: Battle3D constructor (`position.set(0, 24, 27)`, fov 48).
- Music tempo/melody: `startMusic()` in sound.ts (`stepMs`, arrays).
- Character look: builders in characters3d.ts.
