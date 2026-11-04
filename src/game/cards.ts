export type CardId =
  | "knight"
  | "archers"
  | "firecracker"
  | "magic-archer"
  | "giant"
  | "musketeer"
  | "mini-pekka"
  | "skeletons"
  | "fireball"
  | "arrows"
  | "zap"
  | "rage"
  | "freeze"
  | "wizard"
  | "witch"
  | "hog-rider"
  | "balloon"
  | "baby-dragon"
  | "gargoyles"
  | "bats"
  | "minions"
  | "skeleton-army"
  | "executioner"
  | "electro-wizard"
  | "ice-wizard"
  | "princess"
  | "mega-knight"
  | "royal-giant"
  | "valkyrie"
  | "prince"
  | "pekka"
  | "cannon"
  | "tombstone"
  | "elixir-collector"
  | "heal"
  | "tornado"
  | "skeleton-barrel"
  | "mirror"
  | "champion"
  | "stone-golem"
  | "pebble-golem"
  | "digger"
  | "comet";

export type Speed = "slow" | "medium" | "fast";

/** CR-style card rarity, shown as the card frame color. */
export type Rarity = "common" | "rare" | "epic";

/** Tiles per second for each named speed. */
export const SPEED_TILES_PER_SEC: Record<Speed, number> = {
  slow: 0.75,
  medium: 1.1,
  fast: 1.6,
};

export interface UnitStats {
  maxHp: number;
  damage: number;
  /** Seconds between attacks. */
  hitSpeed: number;
  /** Distance (tiles) at which the unit can attack. Melee ≈ 0.8. */
  attackRange: number;
  /** Distance (tiles) at which the unit notices enemy troops. */
  sightRange: number;
  speed: Speed;
  targetsBuildingsOnly: boolean;
  /** Can this unit hit flying targets? */
  targetsAir: boolean;
  /** Does this unit fly (straight paths, only hit by air-targeters)? */
  flying: boolean;
  /** Ground unit that leaps the river instead of detouring to a bridge. */
  jumpsRiver: boolean;
  /** Area damage around the struck target; 0 = single target. */
  splashRadius: number;
  /** Tiles of uninterrupted approach to charge (0 = no charge). */
  chargeDistance: number;
  /** Projectile pierces every enemy along its flight line (false = single hit). */
  pierce: boolean;
  /** Tiles the shooter hops backward (away from its target) after firing (0 = none). */
  recoil: number;
  /** Seconds this unit's hits stun the target (0 = none) — the Electro Wizard zap. */
  stunOnHit: number;
  /** Seconds this unit's hits slow the target's move + attack speed (0 = none). */
  slowOnHit: number;
  /** Number of enemies a single attack strikes at once (1 = normal). */
  chainCount: number;
  /** Multiplier on splash damage to non-primary targets (1 = full). */
  splashDamageFactor: number;
  /**
   * Tiles within which this unit leaps onto a far target, slamming for area
   * damage on landing instead of plodding over (0 = no jump). The Mega Knight.
   */
  jumpRange: number;
  /** Damage dealt to nearby enemies when this unit dies (0 = none). */
  deathDamage: number;
  /** Radius of the death blast in tiles. */
  deathRadius: number;
  /** Card whose units this troop periodically summons (null = none). */
  spawnUnitId: CardId | null;
  /** Card whose units burst out where this unit dies (null = none). */
  deathSpawnId: CardId | null;
  /** How many single units of deathSpawnId burst out (0 = none). */
  deathSpawnCount: number;
  /** Multiplier on this unit's hits against crown towers (1 = full). */
  towerDamageFactor: number;
  /** Seconds between summons (0 = not a spawner). */
  spawnInterval: number;
  /** Seconds per 1 elixir generated for the owner (0 = none). */
  elixirInterval: number;
  /** Visual + collision radius in tiles. */
  radius: number;
}

export interface TroopCard {
  id: CardId;
  name: string;
  rarity: Rarity;
  kind: "troop";
  cost: number;
  /** Number of units spawned per deploy. */
  count: number;
  unit: UnitStats;
  /**
   * A token is a unit only something else can field (the Pebble Golems a
   * Stone Golem bursts into): never in a deck, a chest, a draft or online.
   */
  token?: boolean;
  /**
   * Deploys anywhere on the field (the Digger): it tunnels from its King,
   * untouchable while burrowed, and pops up at the spot.
   */
  deployAnywhere?: boolean;
}

export interface BuildingCard {
  id: CardId;
  name: string;
  rarity: Rarity;
  kind: "building";
  cost: number;
  /** Seconds before the building expires on its own. */
  lifetime: number;
  unit: UnitStats;
}

export interface SpellCard {
  id: CardId;
  name: string;
  rarity: Rarity;
  kind: "spell";
  cost: number;
  damage: number;
  radius: number;
  /** Seconds enemies hit are frozen in place (0 = no stun). */
  stunSeconds: number;
  /** Seconds the spell leaves a friendly speed-boost zone (0 = none). */
  rageSeconds: number;
  /** Tiles survivors are shoved away from the blast center. */
  knockback: number;
  /** HP restored to friendly troops in the radius (0 = none). */
  heal: number;
  /** Tiles enemy troops are dragged toward the blast center (0 = none). */
  pull: number;
  /** Troop card whose units burst out at the target (null = none). */
  spawnUnit: CardId | null;
  /**
   * Seconds between the cast and the damage landing (the Comet falls from
   * the sky; enemies can walk out of it). Absent or 0 = instant.
   */
  landDelay?: number;
}

export type Card = TroopCard | BuildingCard | SpellCard;

const MELEE = 0.8;

interface UnitOverrides extends Partial<UnitStats> {
  maxHp: number;
  damage: number;
  hitSpeed: number;
  attackRange: number;
  speed: Speed;
}

function unit(stats: UnitOverrides): UnitStats {
  return {
    sightRange: 5.5,
    targetsBuildingsOnly: false,
    targetsAir: false,
    flying: false,
    jumpsRiver: false,
    splashRadius: 0,
    chargeDistance: 0,
    pierce: false,
    recoil: 0,
    stunOnHit: 0,
    slowOnHit: 0,
    chainCount: 1,
    splashDamageFactor: 1,
    jumpRange: 0,
    deathDamage: 0,
    deathRadius: 0,
    spawnUnitId: null,
    deathSpawnId: null,
    deathSpawnCount: 0,
    towerDamageFactor: 1,
    spawnInterval: 0,
    elixirInterval: 0,
    radius: 0.5,
    ...stats,
  };
}

export const CARDS: Record<CardId, Card> = {
  knight: {
    id: "knight",
    name: "Knight",
    rarity: "common",
    kind: "troop",
    cost: 3,
    count: 1,
    unit: unit({
      maxHp: 1400,
      damage: 160,
      hitSpeed: 1.2,
      attackRange: MELEE,
      speed: "medium",
    }),
  },
  archers: {
    id: "archers",
    name: "Archers",
    rarity: "common",
    kind: "troop",
    cost: 3,
    count: 2,
    unit: unit({
      maxHp: 250,
      damage: 90,
      hitSpeed: 1.2,
      attackRange: 5,
      speed: "medium",
      targetsAir: true,
      radius: 0.4,
    }),
  },
  firecracker: {
    id: "firecracker",
    name: "Firecracker",
    rarity: "common",
    kind: "troop",
    cost: 3,
    count: 1,
    unit: unit({
      maxHp: 200,
      damage: 130,
      hitSpeed: 3,
      attackRange: 6,
      sightRange: 6,
      speed: "fast",
      targetsAir: true,
      splashRadius: 1.4, // firework bursts into a spread of sparks
      recoil: 2, // kicks herself backward after every shot
      radius: 0.4,
    }),
  },
  "magic-archer": {
    id: "magic-archer",
    name: "Magic Archer",
    rarity: "epic",
    kind: "troop",
    cost: 4,
    count: 1,
    unit: unit({
      maxHp: 460,
      damage: 110,
      hitSpeed: 1.1,
      attackRange: 7, // longest reach in the game
      sightRange: 7,
      speed: "medium",
      targetsAir: true,
      pierce: true, // one arrow damages everything in a line
      radius: 0.45,
    }),
  },
  giant: {
    id: "giant",
    name: "Giant",
    rarity: "rare",
    kind: "troop",
    cost: 5,
    count: 1,
    unit: unit({
      // Stays 3600 in sim v3 although the bot-vs-bot lab has it near the
      // bottom (39%): a tankier starter-deck Giant made the rookie and
      // practice bots beat a beginner more often (notes/features/card-wave-3.md).
      maxHp: 3600,
      damage: 240,
      hitSpeed: 1.5,
      attackRange: MELEE,
      sightRange: 7.5,
      speed: "slow",
      targetsBuildingsOnly: true,
      radius: 0.75,
    }),
  },
  musketeer: {
    id: "musketeer",
    name: "Musketeer",
    rarity: "rare",
    kind: "troop",
    cost: 4,
    count: 1,
    unit: unit({
      maxHp: 600,
      damage: 180,
      hitSpeed: 1.1,
      attackRange: 6,
      sightRange: 6,
      speed: "medium",
      targetsAir: true,
    }),
  },
  "mini-pekka": {
    id: "mini-pekka",
    name: "Mini P.E.K.K.A",
    rarity: "rare",
    kind: "troop",
    cost: 4,
    count: 1,
    unit: unit({
      maxHp: 1100,
      damage: 600,
      hitSpeed: 1.8,
      attackRange: MELEE,
      speed: "fast",
    }),
  },
  skeletons: {
    id: "skeletons",
    name: "Skeletons",
    rarity: "common",
    kind: "troop",
    cost: 1,
    count: 3,
    unit: unit({
      maxHp: 80,
      damage: 80,
      hitSpeed: 1.0,
      attackRange: MELEE,
      speed: "fast",
      radius: 0.3,
    }),
  },
  wizard: {
    id: "wizard",
    name: "Wizard",
    rarity: "rare",
    kind: "troop",
    cost: 5,
    count: 1,
    unit: unit({
      maxHp: 600,
      damage: 230,
      hitSpeed: 1.4,
      attackRange: 5.5,
      sightRange: 6,
      speed: "medium",
      targetsAir: true,
      splashRadius: 1.2,
    }),
  },
  witch: {
    id: "witch",
    name: "Witch",
    rarity: "epic",
    kind: "troop",
    cost: 5,
    count: 1,
    unit: unit({
      maxHp: 700,
      damage: 130,
      hitSpeed: 1.1,
      attackRange: 5,
      sightRange: 5.5,
      speed: "medium",
      targetsAir: true,
      splashRadius: 1.0,
      spawnUnitId: "skeletons",
      spawnInterval: 7,
    }),
  },
  "hog-rider": {
    id: "hog-rider",
    name: "Hog Rider",
    rarity: "rare",
    kind: "troop",
    cost: 4,
    count: 1,
    unit: unit({
      maxHp: 1650,
      damage: 280,
      hitSpeed: 1.5,
      attackRange: MELEE,
      sightRange: 7.5,
      speed: "fast",
      targetsBuildingsOnly: true,
      jumpsRiver: true,
      radius: 0.6,
    }),
  },
  balloon: {
    id: "balloon",
    name: "Balloon",
    rarity: "epic",
    kind: "troop",
    cost: 5,
    count: 1,
    unit: unit({
      maxHp: 1700,
      damage: 640,
      hitSpeed: 2.8,
      attackRange: MELEE,
      sightRange: 7.5,
      speed: "medium",
      targetsBuildingsOnly: true,
      flying: true,
      deathDamage: 320,
      deathRadius: 1.5,
      radius: 0.7,
    }),
  },
  "baby-dragon": {
    id: "baby-dragon",
    name: "Baby Dragon",
    rarity: "epic",
    kind: "troop",
    cost: 4,
    count: 1,
    unit: unit({
      // 1050 to 980 (sim v3): the top of the random-deck lab (62-63%).
      maxHp: 980,
      damage: 130,
      hitSpeed: 1.5,
      attackRange: 3.5,
      speed: "fast",
      targetsAir: true,
      flying: true,
      splashRadius: 1.0,
      radius: 0.6,
    }),
  },
  gargoyles: {
    id: "gargoyles",
    name: "Gargoyles",
    rarity: "common",
    kind: "troop",
    cost: 3,
    count: 3,
    unit: unit({
      maxHp: 190,
      damage: 85,
      hitSpeed: 1.0,
      attackRange: MELEE,
      speed: "fast",
      targetsAir: true,
      flying: true,
      radius: 0.35,
    }),
  },
  bats: {
    id: "bats",
    name: "Bats",
    rarity: "common",
    kind: "troop",
    cost: 2,
    count: 5,
    unit: unit({
      maxHp: 70,
      damage: 70,
      hitSpeed: 1.1,
      attackRange: MELEE,
      speed: "fast",
      targetsAir: true,
      flying: true,
      radius: 0.28,
    }),
  },
  minions: {
    id: "minions",
    name: "Minions",
    rarity: "common",
    kind: "troop",
    cost: 3,
    count: 3,
    unit: unit({
      maxHp: 190,
      damage: 90,
      hitSpeed: 1.0,
      attackRange: 2, // short-range spit (distinguishes them from Gargoyles)
      sightRange: 5.5,
      speed: "fast",
      targetsAir: true,
      flying: true,
      radius: 0.32,
    }),
  },
  "skeleton-army": {
    id: "skeleton-army",
    name: "Skeleton Army",
    rarity: "epic",
    kind: "troop",
    cost: 3,
    count: 15,
    unit: unit({
      maxHp: 80,
      damage: 80,
      hitSpeed: 1.0,
      attackRange: MELEE,
      speed: "fast",
      radius: 0.28,
    }),
  },
  executioner: {
    id: "executioner",
    name: "Executioner",
    rarity: "epic",
    kind: "troop",
    cost: 5,
    count: 1,
    unit: unit({
      maxHp: 1000,
      damage: 180,
      hitSpeed: 2.4,
      attackRange: 4.5,
      sightRange: 6,
      speed: "medium",
      targetsAir: true,
      pierce: true, // the axe flies out in a line through everything it hits
      radius: 0.55,
    }),
  },
  "electro-wizard": {
    id: "electro-wizard",
    name: "Electro Wizard",
    rarity: "epic",
    kind: "troop",
    cost: 4,
    count: 1,
    unit: unit({
      maxHp: 600,
      damage: 150,
      hitSpeed: 1.8,
      attackRange: 5,
      sightRange: 5.5,
      speed: "medium",
      targetsAir: true,
      splashRadius: 0.7, // forked lightning zaps a small cluster
      stunOnHit: 0.5, // every bolt stops its targets for half a second
      chainCount: 2, // forks to two enemies at once
    }),
  },
  "ice-wizard": {
    id: "ice-wizard",
    name: "Ice Wizard",
    rarity: "epic",
    kind: "troop",
    cost: 3,
    count: 1,
    unit: unit({
      maxHp: 600,
      damage: 75, // low damage, big splash control
      hitSpeed: 1.5,
      attackRange: 5.5,
      sightRange: 6,
      speed: "medium",
      targetsAir: true,
      splashRadius: 1.0,
      slowOnHit: 2, // chills targets: slower movement and attacks
    }),
  },
  princess: {
    id: "princess",
    name: "Princess",
    rarity: "epic",
    kind: "troop",
    cost: 3,
    count: 1,
    unit: unit({
      maxHp: 220, // glass cannon
      damage: 140,
      hitSpeed: 3,
      attackRange: 9, // sniper range — fires from across the river
      sightRange: 9,
      speed: "medium",
      targetsAir: true,
      splashRadius: 1.2,
      radius: 0.4,
    }),
  },
  "mega-knight": {
    id: "mega-knight",
    name: "Mega Knight",
    rarity: "epic",
    kind: "troop",
    cost: 7,
    count: 1,
    unit: unit({
      maxHp: 3000,
      damage: 200,
      hitSpeed: 1.7,
      attackRange: MELEE,
      sightRange: 6,
      speed: "medium",
      splashRadius: 1.6, // area slam
      splashDamageFactor: 0.5, // surrounding enemies take half a hit
      // No charge: the jump below is his charge (it also slams).
      jumpRange: 4.5, // leaps onto far troops and buildings, slamming on landing
      radius: 0.8,
    }),
  },
  "royal-giant": {
    id: "royal-giant",
    name: "Royal Giant",
    rarity: "rare",
    kind: "troop",
    cost: 6,
    count: 1,
    unit: unit({
      maxHp: 3100,
      damage: 240,
      hitSpeed: 1.7,
      attackRange: 5, // shoots buildings from range
      sightRange: 7.5,
      speed: "slow",
      targetsBuildingsOnly: true,
      radius: 0.75,
    }),
  },
  valkyrie: {
    id: "valkyrie",
    name: "Valkyrie",
    rarity: "rare",
    kind: "troop",
    cost: 4,
    count: 1,
    unit: unit({
      maxHp: 1500,
      damage: 220,
      hitSpeed: 1.5,
      attackRange: MELEE,
      speed: "medium",
      splashRadius: 1.2,
    }),
  },
  prince: {
    id: "prince",
    name: "Prince",
    rarity: "epic",
    kind: "troop",
    cost: 5,
    count: 1,
    unit: unit({
      maxHp: 1500,
      damage: 325,
      hitSpeed: 1.4,
      attackRange: MELEE,
      speed: "medium",
      chargeDistance: 2.5,
      radius: 0.6,
    }),
  },
  pekka: {
    id: "pekka",
    name: "P.E.K.K.A",
    rarity: "epic",
    kind: "troop",
    cost: 7,
    count: 1,
    unit: unit({
      maxHp: 2900,
      damage: 650,
      hitSpeed: 1.8,
      attackRange: MELEE,
      speed: "slow",
      radius: 0.7,
    }),
  },
  cannon: {
    id: "cannon",
    name: "Cannon",
    rarity: "common",
    kind: "building",
    cost: 3,
    lifetime: 30,
    unit: unit({
      maxHp: 800,
      damage: 160,
      hitSpeed: 0.9,
      attackRange: 5.5,
      speed: "slow", // unused: buildings don't move
      radius: 0.6,
    }),
  },
  tombstone: {
    id: "tombstone",
    name: "Tombstone",
    rarity: "rare",
    kind: "building",
    cost: 3,
    lifetime: 30,
    unit: unit({
      maxHp: 600,
      damage: 0, // it just spawns, never attacks
      hitSpeed: 1,
      attackRange: 0,
      speed: "slow", // unused: buildings don't move
      spawnUnitId: "skeletons",
      spawnInterval: 6,
      // ...and four more skeletons tumble out when it falls (as in CR).
      deathSpawnId: "skeletons",
      deathSpawnCount: 4,
      radius: 0.6,
    }),
  },
  "elixir-collector": {
    id: "elixir-collector",
    name: "Elixir Collector",
    rarity: "rare",
    kind: "building",
    cost: 6,
    lifetime: 70,
    unit: unit({
      maxHp: 900,
      damage: 0, // pure economy, never attacks
      hitSpeed: 1,
      attackRange: 0,
      speed: "slow", // unused: buildings don't move
      elixirInterval: 8.5,
      radius: 0.6,
    }),
  },
  heal: {
    id: "heal",
    name: "Heal",
    rarity: "rare",
    kind: "spell",
    cost: 3,
    damage: 0,
    radius: 3,
    stunSeconds: 0,
    rageSeconds: 0,
    knockback: 0,
    heal: 500,
    pull: 0,
    spawnUnit: null,
  },
  tornado: {
    id: "tornado",
    name: "Tornado",
    rarity: "epic",
    kind: "spell",
    cost: 3,
    damage: 120,
    radius: 4,
    stunSeconds: 0,
    rageSeconds: 0,
    knockback: 0,
    heal: 0,
    pull: 2.5,
    spawnUnit: null,
  },
  "skeleton-barrel": {
    id: "skeleton-barrel",
    name: "Skeleton Barrel",
    rarity: "epic",
    kind: "spell",
    cost: 3,
    // 60 to 150 (sim v3): the barrel's own burst; it sat at 39% in the lab.
    damage: 150,
    radius: 1.5,
    stunSeconds: 0,
    rageSeconds: 0,
    knockback: 0,
    heal: 0,
    pull: 0,
    spawnUnit: "skeletons",
  },
  /**
   * Replays the last card its owner played, at that card's cost +1.
   * The listed cost is a floor for display; battle.ts computes the real
   * price from lastPlayed at deploy time.
   */
  mirror: {
    id: "mirror",
    name: "Mirror",
    rarity: "epic",
    kind: "spell",
    cost: 1,
    damage: 0,
    radius: 0,
    stunSeconds: 0,
    rageSeconds: 0,
    knockback: 0,
    heal: 0,
    pull: 0,
    spawnUnit: null,
  },
  /**
   * The player-designed Studio card. This entry is a neutral baseline;
   * customcard.ts overwrites it in place (applyChampion) with the saved
   * design, so every consumer — sim, bot, HUD, portraits, even Crazy-mode
   * scrambling — sees the player's champion through the normal lookup.
   */
  champion: {
    id: "champion",
    name: "Champion",
    rarity: "epic",
    kind: "troop",
    cost: 3,
    count: 1,
    unit: unit({
      maxHp: 1200,
      damage: 180,
      hitSpeed: 1.3,
      attackRange: MELEE,
      speed: "medium",
    }),
  },
  fireball: {
    id: "fireball",
    name: "Fireball",
    rarity: "rare",
    kind: "spell",
    cost: 4,
    damage: 570,
    radius: 2.5,
    stunSeconds: 0,
    rageSeconds: 0,
    knockback: 0.8,
    heal: 0,
    pull: 0,
    spawnUnit: null,
  },
  arrows: {
    id: "arrows",
    name: "Arrows",
    rarity: "common",
    kind: "spell",
    cost: 3,
    damage: 300, // kills Archers and the Princess; Zap no longer does
    radius: 4,
    stunSeconds: 0,
    rageSeconds: 0,
    knockback: 0,
    heal: 0,
    pull: 0,
    spawnUnit: null,
  },
  zap: {
    id: "zap",
    name: "Zap",
    rarity: "common",
    kind: "spell",
    cost: 2,
    damage: 210, // still clears Bats, Skeletons, Minions and Gargoyles
    radius: 2,
    stunSeconds: 0.5,
    rageSeconds: 0,
    knockback: 0,
    heal: 0,
    pull: 0,
    spawnUnit: null,
  },
  rage: {
    id: "rage",
    name: "Rage",
    rarity: "epic",
    kind: "spell",
    cost: 2,
    damage: 0,
    radius: 2.5,
    stunSeconds: 0,
    rageSeconds: 6,
    knockback: 0,
    heal: 0,
    pull: 0,
    spawnUnit: null,
  },
  freeze: {
    id: "freeze",
    name: "Freeze",
    rarity: "epic",
    kind: "spell",
    cost: 4,
    damage: 0,
    radius: 3,
    stunSeconds: 4,
    rageSeconds: 0,
    knockback: 0,
    heal: 0,
    pull: 0,
    spawnUnit: null,
  },
  // ---- Card wave 3 (sim v3). New cards go last: Crazy mode scrambles in
  // key order, so earlier cards keep their rolls.
  /** A slow boulder that marches on buildings and bursts into two Pebble Golems. */
  "stone-golem": {
    id: "stone-golem",
    name: "Stone Golem",
    rarity: "epic",
    kind: "troop",
    cost: 8,
    count: 1,
    unit: unit({
      maxHp: 5000,
      damage: 260,
      hitSpeed: 2.5,
      attackRange: MELEE,
      sightRange: 7.5,
      speed: "slow",
      targetsBuildingsOnly: true,
      radius: 0.95,
      deathDamage: 260,
      deathRadius: 2.0,
      deathSpawnId: "pebble-golem",
      deathSpawnCount: 2,
    }),
  },
  /** Token: what a Stone Golem bursts into. Never in a deck. */
  "pebble-golem": {
    id: "pebble-golem",
    name: "Pebble Golem",
    rarity: "epic",
    kind: "troop",
    cost: 0,
    count: 1,
    token: true,
    unit: unit({
      maxHp: 950,
      damage: 55,
      hitSpeed: 2.5,
      attackRange: MELEE,
      sightRange: 7.5,
      speed: "slow",
      targetsBuildingsOnly: true,
      radius: 0.6,
      deathDamage: 55,
      deathRadius: 1.5,
    }),
  },
  /** Tunnels to any spot on the field and pops up swinging; chips towers lightly. */
  digger: {
    id: "digger",
    name: "Digger",
    rarity: "epic",
    kind: "troop",
    cost: 3,
    count: 1,
    deployAnywhere: true,
    unit: unit({
      maxHp: 1000,
      damage: 160,
      hitSpeed: 1.2,
      attackRange: MELEE,
      sightRange: 5.5,
      speed: "fast",
      towerDamageFactor: 0.35, // 56 a hit on a crown tower
      radius: 0.5,
    }),
  },
  /** A huge rock that crashes down 1.8 s after the cast: dodgeable, so fair. */
  comet: {
    id: "comet",
    name: "Comet",
    rarity: "epic",
    kind: "spell",
    cost: 6,
    damage: 1000, // 400 to crown towers
    radius: 2.0,
    stunSeconds: 0,
    rageSeconds: 0,
    knockback: 1.0,
    heal: 0,
    pull: 0,
    spawnUnit: null,
    landDelay: 1.8,
  },
};

/** Deck order doubles as the starting draw: the first 4 are the opening hand. */
export const DECK: CardId[] = [
  "knight",
  "archers",
  "firecracker",
  "magic-archer",
  "giant",
  "fireball",
  "musketeer",
  "mini-pekka",
  "baby-dragon",
  "valkyrie",
  "skeletons",
  "wizard",
  "witch",
  "hog-rider",
  "balloon",
  "prince",
  "pekka",
  "cannon",
  "tombstone",
  "elixir-collector",
  "gargoyles",
  "bats",
  "minions",
  "skeleton-army",
  "executioner",
  "electro-wizard",
  "ice-wizard",
  "princess",
  "mega-knight",
  "royal-giant",
  "stone-golem",
  "digger",
  "arrows",
  "zap",
  "rage",
  "freeze",
  "heal",
  "tornado",
  "skeleton-barrel",
  "comet",
  "mirror",
  "champion",
];

/** Units only another card can field (never in DECK, decks, chests or drafts). */
export const TOKEN_IDS: readonly CardId[] = (Object.keys(CARDS) as CardId[]).filter((id) => {
  const c = CARDS[id];
  return c.kind === "troop" && c.token === true;
});

/**
 * May this card go in a deck, a draft, the daily deck or an online match?
 * Not a token, and not the per-device Studio champion.
 */
export function isDeckable(id: CardId): boolean {
  const c = CARDS[id];
  if (!c || id === "champion") return false;
  return !(c.kind === "troop" && c.token === true);
}

/**
 * Per-match card overrides (e.g. the Crazy game mode). When set, getCard
 * returns the scrambled variant so the sim, bot, HUD and renderer all agree.
 */
let cardOverrides: Record<CardId, Card> | null = null;

export function setCardOverrides(overrides: Record<CardId, Card> | null): void {
  cardOverrides = overrides;
}

export function getCard(id: CardId): Card {
  return cardOverrides ? cardOverrides[id] : CARDS[id];
}


/**
 * "Crazy" mode: scramble every card — huge spawn counts, surprise spawners
 * (a Witch summoning Mini P.E.K.K.As), and randomised stats. Summoned units are
 * drawn from a pure pool (no further spawners) so spawn chains stay bounded.
 */
export function crazyCards(rng: () => number = Math.random): Record<CardId, Card> { // purity-allow
  // Crazy rolls its scramble once, before the match and outside the tick.
  // Solo matches roll unseeded; online peers pass the same seeded rng so
  // both scramble identically.
  const ri = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
  const rf = (lo: number, hi: number): number => lo + rng() * (hi - lo);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const out = structuredClone(CARDS) as Record<CardId, Card>;
  // Units that can be summoned. They come in small numbers and never summon
  // themselves, so spawn chains stay one level deep and bounded.
  const spawnPool: CardId[] = ["skeletons", "gargoyles", "bats", "mini-pekka"];

  // The player-designed champion differs per player, so it rolls last:
  // its draws can never shift the stock cards' scramble between peers.
  // Tokens are never scrambled: a cost-0 unit has no count to roll.
  const ids: CardId[] = (Object.keys(out) as CardId[]).filter(isDeckable);
  if (out.champion) ids.push("champion");
  for (const id of ids) {
    const card = out[id];
    if (card.kind === "spell") {
      card.damage = Math.round(card.damage * rf(1, 2.2));
      card.radius = card.radius * rf(1, 1.6);
      continue;
    }

    const u = card.unit;
    u.damage = Math.max(10, Math.round(u.damage * rf(0.7, 1.9)));
    u.maxHp = Math.max(40, Math.round(u.maxHp * rf(0.7, 1.7)));
    if (rng() < 0.3) u.splashRadius = Math.max(u.splashRadius, rf(0.9, 1.7));

    const inPool = spawnPool.includes(id);
    if (card.kind === "troop") {
      // Cheaper cards swarm harder; summonable units stay small so spawners
      // (a Witch) don't flood the field. Archers (cost 3) come ~6-10.
      card.count = inPool
        ? ri(1, 3)
        : Math.min(16, ri(Math.max(2, Math.round(16 / card.cost)), Math.max(3, Math.round(30 / card.cost))));
    }

    const alreadySpawner = u.spawnUnitId !== null;
    if (inPool) {
      u.spawnUnitId = null;
      u.spawnInterval = 0;
    } else if (card.kind === "building" || alreadySpawner || rng() < 0.3) {
      // Buildings + existing spawners always get a scrambled summon; ~30% of
      // other troops gain a surprise one (a Witch summoning Mini P.E.K.K.As).
      u.spawnUnitId = pick(spawnPool);
      u.spawnInterval = rf(5, 9);
    }
  }

  return out;
}

/**
 * CR-style battle deck: exactly 8 cards. The first 4 are the opening
 * hand; this starter deck keeps the classic opening (knight, archers,
 * giant, fireball).
 */
export const DEFAULT_DECK: CardId[] = [
  "knight",
  "archers",
  "giant",
  "fireball",
  "musketeer",
  "mini-pekka",
  "baby-dragon",
  "arrows",
];
