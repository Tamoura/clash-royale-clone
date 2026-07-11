# CR match: steep top-down camera (user suggestion)

User: "the battlefield should be more 2d while characters 3d as
clash royal". CR's flat-field look comes from a ~65deg camera.

- CAM_HOME = (0, 36, 17), lookAt (0,0,1), fov 48 -> ~66deg
  elevation. Chosen by grid search (three.js projection of arena
  corners + stand tops) so everything fits NDC at the stage aspect,
  since browser screenshots are currently unavailable.
- Shake jitter/reset and reset() now use CAM_HOME instead of
  hardcoded coordinates.
- BAR_TILT derives from CAM_HOME so HP pills face the camera
  square-on at the new angle.
