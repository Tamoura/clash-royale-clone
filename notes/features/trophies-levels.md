# Trophies + card levels (realism: progression)

- Sim: SideState.levels (CardLevels) + levelMultiplier (+10%/level,
  tested): scales troop/building HP+damage+death damage+decay and
  spell damage. createBattle takes { player, enemy } levels.
- Meta (main.ts, localStorage): trophies +30 win / -20 loss (floor
  0); each win levels up 2 random deck cards (cap Lv.11). The bot
  levels ALL its cards 1 per 150 trophies — a soft ladder.
- HUD: trophy chip in the top bar, gold Lv.n chips on hand cards,
  reward line on the result overlay (cleared on rematch).
