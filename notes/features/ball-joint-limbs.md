# Ball-jointed limbs (design round)

- New exported articulate(rig): every arm gains a shoulder ball at
  its pivot + a gloved fist at its end; every leg gains a hip joint
  + a chunky forward-toed foot. Sizes derive from each limb's own
  bounding box; joints reuse the limb's material instance so damage
  flash and death fade stay uniform (all tested).
- Runs in buildTroop for all troops and on the tower crew in
  scene3d; joint spheres go through the shared geometry cache.
