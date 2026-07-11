# Clash Royale — Unity edition

A second build of the game, sharing the **exact** deterministic battle
simulation as the original TypeScript + Three.js version. The sim was ported
to C# line-for-line and verified to produce bit-identical results (same PRNG
stream, same entity positions/HP after thousands of ticks).

The web intro's **Native / Unity** toggle launches this build once you've
compiled it for WebGL into `public/unity/` (see below).

## Project

`ClashRoyaleUnity/` — open this folder in **Unity 2022.3 LTS** (2022.3.40f1;
any 2022.3.x works). The render pipeline is the **Built-in** pipeline; no
extra packages beyond uGUI and the Test Framework are required.

```
ClashRoyaleUnity/
  Assets/
    Scripts/
      Sim/    UnityEngine-free C# port of src/game/ (asmdef: ClashRoyale.Sim)
      Game/   Bootstrap + GameView + BattleHud (drives the sim, renders primitives)
    Tests/EditMode/   NUnit tests mirroring the TS sim suite
    Scenes/Battle.unity   minimal scene (the game builds itself at runtime)
  Packages/manifest.json
  ProjectSettings/ProjectVersion.txt
```

### Character models (CC0 — fetch first)

Troops use real rigged + animated **KayKit** character models (CC0, by Kay
Lousberg). The `.fbx` files (~20 MB each, they embed 76 animations) are **not
committed**; pull them before building:

```sh
bash unity/fetch-assets.sh
```

This downloads the KayKit Adventurers + Skeletons packs from GitHub into
`Assets/Resources/KayKit/`. Cards map to models in
`Assets/Scripts/Game/KayKitModels.cs` (Knight, Mage, Rogue, Barbarian,
Skeleton); flyers/buildings still use the primitive `CharacterFactory`. The
runtime loads the model + its animation clips from Resources and drives
idle/walk via `CharacterAnim` (a small PlayableGraph — no AnimatorController
asset needed).

### How it runs

`Bootstrap` uses `[RuntimeInitializeOnLoadMethod]`, so the whole game
(arena, towers, units, HUD, camera) is constructed in code the moment you
press **Play** — the scene can stay empty. There is no manual GameObject
wiring to set up.

- Tap a card in the hand, then tap your half of the arena to deploy.
- Elixir, the 4-card rotating hand, the elixir-aware bot, towers, spells,
  flying units, the river/bridges — all driven by the shared sim.

### Running the tests

`Window > General > Test Runner > EditMode > Run All`. These mirror the
TypeScript `src/game/*.test.ts` suite (elixir, hand, arena, cards, battle,
sim determinism, and the mulberry32 PRNG matching the JS reference values).

## Building for WebGL (to enable the intro toggle)

1. `File > Build Settings > WebGL > Switch Platform`.
2. Add `Assets/Scenes/Battle.unity` to *Scenes In Build* (or just have it open).
3. **Build** to a temporary folder. Unity produces an `index.html` plus a
   `Build/` and `TemplateData/` folder.
4. Copy the **contents** of that output into the web project's
   `public/unity/` folder, so `public/unity/index.html` exists.
5. Run the web app (`npm run dev`); on the intro pick **Unity** and press
   **Launch Unity**. Vite serves the build at `/unity/` and the toggle loads
   it in an iframe. (Until a build is present, the toggle shows a friendly
   "not built yet" placeholder.)

> Tip: WebGL builds must be served over HTTP (not opened as a `file://`
> path). Running through Vite handles this automatically.

### One-command headless build

The repo ships an Editor build script (`Assets/Editor/WebGLBuilder.cs`) so you
can build straight into the web project's serve slot without the GUI:

```sh
UNITY="/Applications/Unity/Hub/Editor/2022.3.62f3/Unity.app/Contents/MacOS/Unity"
CR_WEBGL_OUT="$(pwd)/../../public/unity" \
"$UNITY" -batchmode -nographics -quit \
  -projectPath "$(pwd)" -buildTarget WebGL \
  -executeMethod ClashRoyale.Editor.WebGLBuilder.Build \
  -logFile /tmp/unity-webgl.log
```

(Run from `unity/ClashRoyaleUnity`. The script disables aggressive code
stripping and force-includes the Standard shader, which a default WebGL build
would otherwise strip — primitives would render magenta and `BoxCollider`
would be missing.)

Run the EditMode tests headlessly the same way:

```sh
"$UNITY" -batchmode -nographics -projectPath "$(pwd)" \
  -runTests -testPlatform EditMode -testResults /tmp/results.xml
```

## Why a port instead of sharing code?

The TypeScript sim can't run inside Unity's C# runtime, so the simulation
was re-implemented in C# under `Assets/Scripts/Sim/`. To guarantee the two
editions stay the same game, the port is verified against the TS sim with a
deterministic fingerprint (identical entity state after a long scripted
battle) and PRNG parity tests.
