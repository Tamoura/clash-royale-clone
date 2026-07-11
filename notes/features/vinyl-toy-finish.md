# Vinyl-toy finish (frontend-design skill round)

Design direction: designer vinyl figurines. The "crude shape
stack" read came from hard-edged BoxGeometry and coarse spheres.

- box() now uses RoundedBoxGeometry (bevel = 28% of smallest dim):
  every limb, torso, weapon, and hammer head is softly rounded
  across all 17 characters at once.
- Spheres 14x12 -> 20x16 segments, cylinders 14 -> 20, cones
  12 -> 16: smooth toy silhouettes.
