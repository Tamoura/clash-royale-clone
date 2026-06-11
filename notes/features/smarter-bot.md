# Smarter bot

Defense-aware card selection for the AI opponent.

## Changes

- `defenseCandidates(threat)`: when defending, the bot now skips
  building-only seekers (Giant/Hog/Balloon stroll past invaders) and,
  against a flying threat, considers air-targeters only.
- If nothing in hand can fight the threat, the bot saves elixir
  rather than tossing a useless card.
- Zap joined fireball/arrows in `trySpellCluster`; the existing
  "worth more than the spell costs" value check keeps it honest
  (a 1-elixir skeleton pack never gets zapped).

## Testing

Air/ground filtering is asserted across several RNG seeds so the
random pick can't mask a missing filter.
