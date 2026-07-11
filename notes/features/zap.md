# Zap (stun spell)

2-elixir instant spell: small damage in a 2-tile radius plus a 0.5s
stun on everything it hits.

## Design decisions

- `SpellCard.stunSeconds` (0 for fireball/arrows) flows through
  `applySpell` into `Entity.stunTimer`. Stunned entities skip their
  whole act phase (no retarget/move/attack) until the timer drains.
  Stuns don't stack — `Math.max` keeps the longer remaining stun.
- Towers can be zapped too (matches CR), tested implicitly via the
  generic applySpell path.
- Renderer: jagged sky-bolt + yellow flash ring; synth crackle SFX.
- Test gotcha: a unit standing mid-river walks *backward* to line up
  with a bridge entrance, so "moves again after stun" asserts
  `not.toBe(yBefore)` rather than a direction.
