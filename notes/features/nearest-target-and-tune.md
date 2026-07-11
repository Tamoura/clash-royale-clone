# Straight ortho board + nearest target + size tune

User feedback bundle:
1. Troops should go to the NEAREST enemy (troop/tower/building),
   not always prefer an in-sight troop over a closer tower.
   acquireTarget now picks nearest among (in-sight hittable troops)
   + (all hittable buildings). Two TDD tests.
2. Towers 150%: EntityView.baseScale = 1.5 for towers, respected by
   the spawn-pop reset logic. Troops also *1.5 (scene3d scale).
3. "Straight arena, from player sight not top sky": switched
   PerspectiveCamera -> OrthographicCamera (no convergence = straight
   rectangular board), angled from the player's elevated side
   (CAM_HOME 0,34,22 ~58deg). frameOrtho() fits the 18x32 board to
   the viewport (halfH 15.5, halfW >= 10.5 so the field never crops).
4. Per-card elixir veil: a conic-gradient dark overlay on each
   unaffordable card retreats clockwise as elixir -> cost (cardVeils
   updated each frame); locked cards desaturate.
