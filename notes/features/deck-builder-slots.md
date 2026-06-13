# Deck builder: top 8-slot row (better UX)

User: deck should have a top 8-card area that fills as you pick
from the collection; tap a deck slot to unselect.

- buildDeckPicker rebuilt: ordered deck[] (max 8). Top deck-slots
  row (gold frame, 4x2) shows filled cards in pick order + empty
  dashed slots; click a filled slot to remove. Collection grid
  below ("tap to add"); chosen cards dim to 40%. Tapping a chosen
  collection card also removes it. Shared cardTileCanvas helper.
