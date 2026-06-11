export type CardId =
  | "knight"
  | "archers"
  | "giant"
  | "musketeer"
  | "mini-pekka"
  | "skeletons"
  | "fireball"
  | "arrows"
  | "wizard"
  | "baby-dragon"
  | "gargoyles"
  | "valkyrie"
  | "prince"
  | "cannon";

export type Speed = "slow" | "medium" | "fast";

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
  /** Area damage around the struck target; 0 = single target. */
  splashRadius: number;
  /** Tiles of uninterrupted approach to charge (0 = no charge). */
  chargeDistance: number;
  /** Visual + collision radius in tiles. */
  radius: number;
}

export interface TroopCard {
  id: CardId;
  name: string;
  kind: "troop";
  cost: number;
  /** Number of units spawned per deploy. */
  count: number;
  unit: UnitStats;
}

export interface BuildingCard {
  id: CardId;
  name: string;
  kind: "building";
  cost: number;
  /** Seconds before the building expires on its own. */
  lifetime: number;
  unit: UnitStats;
}

export interface SpellCard {
  id: CardId;
  name: string;
  kind: "spell";
  cost: number;
  damage: number;
  radius: number;
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
    splashRadius: 0,
    chargeDistance: 0,
    radius: 0.5,
    ...stats,
  };
}

export const CARDS: Record<CardId, Card> = {
  knight: {
    id: "knight",
    name: "Knight",
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
  "baby-dragon": {
    id: "baby-dragon",
    name: "Baby Dragon",
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
  cannon: {
    id: "cannon",
    name: "Cannon",
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
  fireball: {
    id: "fireball",
    name: "Fireball",
    kind: "spell",
    cost: 4,
    damage: 570,
    radius: 2.5,
  },
  arrows: {
    id: "arrows",
    name: "Arrows",
    kind: "spell",
    cost: 3,
    damage: 240,
    radius: 4,
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
  "prince",
  "cannon",
  "gargoyles",
  "arrows",
];

export function getCard(id: CardId): Card {
  return CARDS[id];
}
