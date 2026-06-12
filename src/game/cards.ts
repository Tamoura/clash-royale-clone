export type CardId =
  | "knight"
  | "archers"
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
  | "valkyrie"
  | "prince"
  | "pekka"
  | "cannon"
  | "tombstone"
  | "elixir-collector";

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
  /** Damage dealt to nearby enemies when this unit dies (0 = none). */
  deathDamage: number;
  /** Radius of the death blast in tiles. */
  deathRadius: number;
  /** Card whose units this troop periodically summons (null = none). */
  spawnUnitId: CardId | null;
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
    deathDamage: 0,
    deathRadius: 0,
    spawnUnitId: null,
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
  giant: {
    id: "giant",
    name: "Giant",
    rarity: "rare",
    kind: "troop",
    cost: 5,
    count: 1,
    unit: unit({
      maxHp: 3300,
      damage: 210,
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
      maxHp: 1500,
      damage: 260,
      hitSpeed: 1.6,
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
      maxHp: 1500,
      damage: 600,
      hitSpeed: 3,
      attackRange: MELEE,
      sightRange: 7.5,
      speed: "medium",
      targetsBuildingsOnly: true,
      flying: true,
      deathDamage: 300,
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
      maxHp: 1050,
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
      maxHp: 3000,
      damage: 750,
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
      damage: 130,
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
  },
  arrows: {
    id: "arrows",
    name: "Arrows",
    rarity: "common",
    kind: "spell",
    cost: 3,
    damage: 240,
    radius: 4,
    stunSeconds: 0,
    rageSeconds: 0,
    knockback: 0,
  },
  zap: {
    id: "zap",
    name: "Zap",
    rarity: "common",
    kind: "spell",
    cost: 2,
    damage: 250,
    radius: 2,
    stunSeconds: 0.5,
    rageSeconds: 0,
    knockback: 0,
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
  },
};

/** Deck order doubles as the starting draw: the first 4 are the opening hand. */
export const DECK: CardId[] = [
  "knight",
  "archers",
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
  "arrows",
  "zap",
  "rage",
  "freeze",
];

export function getCard(id: CardId): Card {
  return CARDS[id];
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
