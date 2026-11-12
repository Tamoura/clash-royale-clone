# Third-party notices

This game (Crown Rush, this repository) ships a small set of third-party
assets and libraries. Everything
else in the game (towers, ground, river and bridges, the court and its crowd,
creatures, mounts, effects, card buildings, music and sound) is procedural
and original to this project. No Supercell or Clash Royale assets, logos or
likenesses are used.

## 3D models (CC0 1.0)

The modelled cast (every humanoid card and the tower crews, both editions)
is built from two CC0 packs by Kay Lousberg. `tools/troop-pack.mjs` reads the
meshes, props and clips the game uses and packs them into
`public/models/troops/` (seven files, 803,308 bytes in all); the game bakes
each card's variant from them at run time. Per-folder credits, with the
SHA-256 of every source file read, are in
[`public/models/troops/CREDITS.txt`](public/models/troops/CREDITS.txt).

| Pack | Version | Author | Source | Licence |
|---|---|---|---|---|
| KayKit Adventurers Character Pack | 1.0 (commit `672074b73ba276876a19e8816ecdc5241817ab47`) | Kay Lousberg, www.kaylousberg.com | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | CC0 1.0 Universal |
| KayKit Skeletons Character Pack | 1.0 (commit `15b62b9bad122f72926c10fb14d622c73819fa54`) | Kay Lousberg, www.kaylousberg.com | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 | CC0 1.0 Universal |

CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/ (no
attribution required; credited here as thanks).

SHA-256 of the shipped files in `public/models/troops/`:

```
614ce1e1571eea599b19fcf84a232eacc90ade7f4a460437be845b5ce67906e6  anims.glb
0b0b4f3acfdbbb958ae74435c18a61a0bc1d552d4be921e2601998662b3226db  barbarian.glb
ff9c5e8d7514b3cbc4edf169cd5100239f10da70ed7b3b096460b901a94c9e86  knight.glb
a095dc959d1639fee77b490c91279dcde7f7575e01d8284ae46bcfb07518aa50  mage.glb
76eef7a6ef3bddce0ae9d24559fa600dfb2be4ccb80fae500b13d26fb27bd0bc  rogue.glb
64f9059ce06104f10e031ef75c4a6d7550890edc3028276a80e340c5c5327c9c  rogue_hooded.glb
106c4f70453a86bfcdd397c645b773bf0b6022550739c01515cf820acb010bfb  skeleton_minion.glb
```

The KayKit Medieval Hexagon Pack, which the art direction allowed for the
outer ring, is not used: the outer ring is procedural, so there is no
`public/models/kit/` folder.

## Fonts (SIL Open Font License 1.1)

Bundled from the `@fontsource` npm packages (the font files are copied into
the build's `assets/`).

| Font | Package | Copyright | Licence |
|---|---|---|---|
| Lilita One | `@fontsource/lilita-one` 5.3.0 | Copyright (c) 2011 Juan Montoreano, with Reserved Font Name "Lilita One" | SIL OFL 1.1 |
| Baloo Bhaijaan 2 (Arabic, 700 and 800) | `@fontsource/baloo-bhaijaan-2` 5.3.0 | Copyright 2019 The Baloo 2 Project Authors (https://github.com/EkType/Baloo2) | SIL OFL 1.1 |

The full licence text ships with each package (`node_modules/@fontsource/*/LICENSE`)
and is at https://openfontlicense.org.

## Libraries

| Library | Version | Use | Licence |
|---|---|---|---|
| three.js | 0.184.0 | rendering (bundled) | MIT, Copyright (c) 2010-2026 three.js authors |
| meshoptimizer decoder (`three/examples/jsm/libs/meshopt_decoder.module.js`) | 1.1 | decodes the packed cast (lazy chunk) | MIT, Copyright (C) 2016-2026 Arseny Kapoulkine |
| ws | 8.21.0 | the multiplayer relay server (not in the browser bundle) | MIT |
| gltfpack (meshoptimizer) | 0.22 | dev-time packing of the cast (`tools/troop-pack.mjs`, run through npx; not shipped) | MIT |
