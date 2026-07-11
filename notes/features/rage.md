# Rage (buff-zone spell)

2-elixir damage-free spell leaving a 6s zone where friendly troops
move and attack 35% faster.

## Design decisions

- New `BattleState.buffZones` (side, x, y, radius, ttl), ticked and
  filtered like spell effects. `SpellCard.rageSeconds` marks the card.
- The boost multiplies the per-tick dt for movement and cooldown
  recovery (`RAGE_BOOST = 1.35` in sim.ts) — a single code path, no
  stat mutation, so leaving the zone instantly drops the bonus.
- Buildings/towers inside the zone also recover attacks faster
  (matches CR where rage affects buildings).
- Renderer: spell event spawns a pulsing purple ring + haze for the
  zone's lifetime; effects list also carries it for the 2D path.
- Tests compare displacement of identical knights across separate
  battles (raged vs control) to stay independent of pathing details.
