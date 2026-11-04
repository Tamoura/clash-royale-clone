/**
 * The bot's tower troop and King's ability. A fair bot only uses what the
 * player could pick at their arena (meta/unlocks.ts): before tower troops
 * unlock it defends with the Princess, and before abilities unlock it uses
 * Royal Rally, the same defaults the player gets (battleSetup enforceUnlocks).
 */
import { ABILITY_IDS, type AbilityId } from "../game/abilities";
import { TOWER_TROOP_IDS, type TowerTroopId } from "../game/towers";
import { featureUnlocked } from "../meta/unlocks";

export interface BotLoadout {
  towerTroop: TowerTroopId;
  ability: AbilityId;
}

/** Every tower troop the bot may use at this arena index. */
export function botTowerTroopPool(arenaIndex: number): TowerTroopId[] {
  return featureUnlocked("towerTroops", arenaIndex) ? [...TOWER_TROOP_IDS] : [TOWER_TROOP_IDS[0]];
}

/** Every King's ability the bot may use at this arena index. */
export function botAbilityPool(arenaIndex: number): AbilityId[] {
  return featureUnlocked("abilities", arenaIndex) ? [...ABILITY_IDS] : [ABILITY_IDS[0]];
}

const pick = <T>(pool: readonly T[], rng: () => number): T =>
  pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];

/** A random loadout from what is unlocked at `arenaIndex`. */
export function pickBotLoadout(arenaIndex: number, rng: () => number = Math.random): BotLoadout {
  return { towerTroop: pick(botTowerTroopPool(arenaIndex), rng), ability: pick(botAbilityPool(arenaIndex), rng) };
}
