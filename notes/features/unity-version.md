# Unity edition + native/Unity intro toggle

Branch: `unity-version`

## Goal

Add a second, Unity-built version of the game while keeping the existing
TypeScript + Three.js ("native") version fully intact. The intro
(deck-picker) screen gets a **Native / Unity** toggle that chooses which
edition to launch.

## Clarified decisions (from the user)

- **Unity deliverable:** a buildable scaffold — the deterministic sim
  ported to C#, a playable battle scene, and project files the user opens
  and builds in Unity themselves. Unity is **not installed on this
  machine**, so the C# cannot be compiled/run here; the EditMode tests are
  authored to run inside Unity but were not executed locally.
- **Toggle placement:** on the existing web intro/deck-picker screen.
  Native runs in-page; Unity loads its WebGL build from `/unity/` (a
  friendly placeholder shows until a build is dropped in).

## Web side (done, TDD)

- `src/launcher/mode.ts` — pure, storage-injectable: `GameMode`
  (`native` | `unity`), `loadMode`/`saveMode` (localStorage key
  `cr-clone-mode`, default `native`), `unityBuildUrl()` → `unity/index.html`,
  `checkUnityBuild(fetch)`. Tested in `mode.test.ts` (node env, no DOM).
- `src/launcher/unityPanel.ts` — `launchUnity(host, onBack)`: HEAD-probes
  the build; shows an `<iframe>` to `/unity/` when present, else a
  placeholder explaining how to build it.
- `index.html` — `#unity-stage` host + styles; `.mode-row` toggle styles.
- `src/main.ts` — toggle on the deck-picker; in Unity mode the Battle
  button becomes "Launch Unity" and opens the Unity stage.

The Unity WebGL build goes in `public/unity/` so Vite serves it at `/unity/`.

## Unity side

Project: `unity/ClashRoyaleUnity` (Unity 2022.3 LTS, Built-in pipeline).

- `Assets/Scripts/Sim/` — UnityEngine-free C# port of `src/game/`
  (`ClashRoyale.Sim` asmdef). Faithful to the TS sim incl. the mulberry32
  bot RNG so battles stay reproducible.
- `Assets/Scripts/Game/` — `Bootstrap` MonoBehaviour builds the arena,
  towers, and entity views from primitives at runtime, drives the sim,
  handles deploy input, and renders a minimal HUD.
- `Assets/Tests/EditMode/` — NUnit tests mirroring the TS sim tests.
- `unity/README.md` — open + WebGL build instructions.

## Verification

Unity isn't installed locally, so the C# was verified out-of-band with the
`dotnet` 9 SDK (the Sim assembly is UnityEngine-free):

- **PRNG parity:** C# `Mulberry32` matches the JS mulberry32 stream exactly
  for seeds 1 and 12345.
- **Sim parity:** a scripted 40s battle (bot seed 777, scripted Giant deploy)
  produces a **bit-identical** end-state fingerprint in TS and C# — same
  entity hash (`443274240`), crowns, elixir, and damage.
- **EditMode tests:** the 24 NUnit tests compile and pass under `dotnet test`
  with NUnit 3.x (matching Unity's NUnit 3.5).
- The Game/ MonoBehaviours depend on UnityEngine and were not compiled here;
  written against stable 2022.3 APIs and reviewed (note: class `Sim` was
  renamed `Simulation` to avoid a namespace/type collision in `ClashRoyale.Game`).

## Status

- [x] Web mode module + tests (green)
- [x] Web intro toggle + Unity panel
- [x] C# sim port (verified bit-identical to TS)
- [x] Unity scene + driver + HUD
- [x] Unity project files + EditMode tests + README
- [ ] PR
