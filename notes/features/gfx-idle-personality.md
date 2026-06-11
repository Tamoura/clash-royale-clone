# Graphics: idle personality (extras hook)

- TroopRig gained an optional `extras(t, phase)` hook, invoked at
  the end of every animateTroop call (tested with a spy).
- Quirks: the witch's skull familiar orbits her (facing outward),
  the wizard's fire orb breathes and sputters, the baby dragon
  wags its tail. Phase offset keeps duplicates out of sync.
