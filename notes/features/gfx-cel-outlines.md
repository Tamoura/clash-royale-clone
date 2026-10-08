# Graphics: cel outlines

- One shared back-face ShaderMaterial (`outlineMaterial.ts`) pushes each
  hull vertex outward in CLIP space along a cached, smoothed
  `outlineNormal` (normals averaged over coincident vertices, so hard edges
  and sphere seams extrude together). The line is `OUTLINE_CSS_PX` = 2 CSS px
  at any zoom and device pixel ratio; every hull refreshes the viewport
  uniforms from whichever renderer is drawing it (`fitInk`), so card
  portraits and the gallery get the same 2 px.
- `outlineRig(group)` keeps its name for rigs that are not baked (card
  portraits, the gallery, the deploy ghost): a hull child per mesh whose
  bounding radius is >= 0.05 (`OUTLINE_MIN_RADIUS`). Face parts and the orb
  stay unlined however big they are.
- Baked troops (`rigBake.ts`, see perf-bake-ship.md) carry their ink inside
  their own meshes: the hull triangles are wound inside-out and flagged by a
  non-zero `outlineNormal`, and the baked toon material extrudes and paints
  them, so one draw call covers a node's body and its outline.
- Quality L4 turns every outline off through one switch
  (`setOutlinesVisible`, applied with the quality level).
