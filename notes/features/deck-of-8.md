# 8-card battle decks + deck builder

- Sim: createBattle(playerDeck?, enemyDeck?) defaults to a starter
  DEFAULT_DECK (first 4 = classic opening hand so legacy tests
  hold); isValidDeck enforces exactly 8 unique known cards (tested).
  DECK (23) is now the collection pool.
- UI: full-screen deck picker (grid of all 23 with art/cost/name,
  golden Battle! button gated on 8 picks), shown on load and via a
  topbar button; choice persists in localStorage. The bot drafts
  a random legal deck every match. Sim is paused while picking.
