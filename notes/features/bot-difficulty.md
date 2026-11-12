# Bot difficulty

- BotProfile { thinkInterval, pushAt }; createBot(seed, profile)
  (tested: slow thinker waits, aggressive bot pushes at 5 elixir).
- Deck picker gained an easy/normal/hard selector (persisted):
  easy 1.8s thinker pushing at 9, normal 1.0/8, hard 0.55s/6.

Superseded: these were the first three tiers. The current five-tier
ladder (practice to hard), its measured staircase, the frozen puzzle
solver and the auto rule are in `bot-ladder.md`.
