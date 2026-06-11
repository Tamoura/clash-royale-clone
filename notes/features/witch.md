# Witch (spawner troop)

5-elixir ranged splash troop that periodically summons a wave of
Skeletons (the existing 1-elixir card) on her own side.

## Design decisions

- Spawner mechanic is generic: `UnitStats.spawnUnitId` +
  `spawnInterval`, copied onto the entity (`spawnUnitId`,
  `spawnInterval`, `spawnTimer`). Any troop or building card can be a
  spawner later (Tombstone, Goblin Hut, ...).
- First wave fires `FIRST_SPAWN_DELAY` (1s) after the deploy freeze,
  then every `spawnInterval` (7s) — matches CR feel and means a witch
  played at the back has skeletons with her before reaching the bridge.
  (Initial naive version spawned the first wave only after a full
  interval; by then the witch had walked to the river and her skeletons
  died to tower fire before the mechanics test's 10s checkpoint.)
- Waves are spawned via `spawnUnits`, so the wave size is the summoned
  card's own `count` (3 skeletons) and the spawn offsets prevent
  stacking. Summons spawn slightly toward the enemy side of the witch.
- Summoned units inherit the normal 1s deploy freeze.

## Stats

cost 5, HP 700, dmg 130 splash 1.0, range 5, hits air, medium speed,
spawns skeletons every 7s.
