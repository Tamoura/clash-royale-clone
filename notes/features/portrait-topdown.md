# Portrait top-down camera (match CR layout)

User shared the FIRST version's Desktop screenshot: a portrait,
straight-top-down flat board. Our 3D view was landscape + tilted
so the tall 18x32 arena looked small/awkward.

- Layout: #app width -> min(100vw, 52vh) so the app is a portrait
  phone column; the 18x32 arena (exactly 9:16) fills it vertically.
- Camera: CAM_HOME 25,26 -> 40,15, lookAt z 1.5 -> 0 (~73deg, near
  top-down) so the board reads flat and vertical, player towers at
  the bottom, enemy at top, like CR. Characters keep 3D shading.
