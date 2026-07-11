# Unity WebGL build slot

Drop the **contents** of a Unity WebGL build here so this folder contains
`index.html` (plus the `Build/` and `TemplateData/` folders Unity emits).

Vite serves this directory at `/unity/`, and the intro screen's **Unity**
toggle loads `/unity/index.html` in an iframe. Until a build is present, the
toggle shows a "not built yet" placeholder.

See `../../unity/README.md` for how to produce the build from the Unity
project in `unity/ClashRoyaleUnity/`.

The build artifacts themselves are intentionally **not** committed (see the
ignore rule in the repo `.gitignore`); only this placeholder is tracked.
