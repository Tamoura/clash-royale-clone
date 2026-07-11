# Surface texturing round (3d-texturing skill)

The skill's core: flat surfaces need a detail/AO-style map. Every
toon() material was a single solid color (plastic look).

- grainMap(): one shared procedural DataTexture (no DOM — like the
  existing gradientMap, so it works in node tests + headless +
  browser). 64px, bright base 0.86..1.0 (gentle darkening only),
  diagonal weave threads + deterministic speckle, repeat(2,2) for
  fine grain. Marked userData.shared so disposeDeep skips it.
- toon(color) now sets map: grainMap() on every material. Material
  INSTANCES stay per-call (emissive flash/rage/charge mutate them
  per entity) — only the texture is shared. Both invariants tested.
- Reads as woven cloth / brushed surface on every character;
  colors stay punchy. Verified via giant + knight portraits.
