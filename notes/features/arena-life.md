# Arena life + voice barks (realism)

- Crowd reactions: spectator bodies/heads (crowdParts with stored
  baseY) hop for 1.8s whenever a crown falls.
- Ambient birds: a flapping two-wing bird crosses the sky every
  ~9-17s (deterministic-ish timing off waterTime, no Math.random).
- Voice barks (sound.ts bark()): synth war-cries layered on the
  deploy thump — hog rider's falling yell, witch's 3-note cackle,
  knight/giant grunts, valkyrie's rising cry, prince's pony trill,
  P.E.K.K.A clank+servo, wizard's "ha!" + fire hiss.
