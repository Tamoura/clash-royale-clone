# Overtime tower-HP tiebreak

CR rule: if overtime ends with crowns still tied, the player whose
most-damaged crown tower is healthier wins; identical damage draws.

- `towerHpTiebreak` compares min tower HP per side (towers have
  cardId null, distinguishing them from deployed buildings).
- Tests cover the basic tiebreak and the "worst tower, not total
  damage" subtlety; the all-square draw test still passes.
