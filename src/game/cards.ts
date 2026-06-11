export type CardId =
  | "knight"
  | "archers"
  | "giant"
  | "musketeer"
  | "mini-pekka"
  | "skeletons"
  | "fireball"
  | "arrows";

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

export interface SpellCard {
  id: CardId;
  name: string;
  kind: "spell";
  cost: number;
  damage: number;
  radius: number;
}

export type Card = TroopCard | SpellCard;

const MELEE = 0.8;

export const CARDS: Record<CardId, Card> = {
  knight: {
    id: "knight",
    name: "Knight",
    kind: "troop",
    cost: 3,
    count: 1,
    unit: {
      maxHp: 1400,
      damage: 160,
      hitSpeed: 1.2,
      attackRange: MELEE,
      sightRange: 5.5,
      speed: "medium",
      targetsBuildingsOnly: false,
      radius: 0.5,
    },
  },
  archers: {
    id: "archers",
    name: "Archers",
    kind: "troop",
    cost: 3,
    count: 2,
    unit: {
      maxHp: 250,
      damage: 90,
      hitSpeed: 1.2,
      attackRange: 5,
      sightRange: 5.5,
      speed: "medium",
      targetsBuildingsOnly: false,
      radius: 0.4,
    },
  },
  giant: {
    id: "giant",
    name: "Giant",
    kind: "troop",
    cost: 5,
    count: 1,
    unit: {
      maxHp: 3300,
      damage: 210,
      hitSpeed: 1.5,
      attackRange: MELEE,
      sightRange: 7.5,
      speed: "slow",
      targetsBuildingsOnly: true,
      radius: 0.75,
    },
  },
  musketeer: {
    id: "musketeer",
    name: "Musketeer",
    kind: "troop",
    cost: 4,
    count: 1,
    unit: {
      maxHp: 600,
      damage: 180,
      hitSpeed: 1.1,
      attackRange: 6,
      sightRange: 6,
      speed: "medium",
      targetsBuildingsOnly: false,
      radius: 0.5,
    },
  },
  "mini-pekka": {
    id: "mini-pekka",
    name: "Mini P.E.K.K.A",
    kind: "troop",
    cost: 4,
    count: 1,
    unit: {
      maxHp: 1100,
      damage: 600,
      hitSpeed: 1.8,
      attackRange: MELEE,
      sightRange: 5.5,
      speed: "fast",
      targetsBuildingsOnly: false,
      radius: 0.5,
    },
  },
  skeletons: {
    id: "skeletons",
    name: "Skeletons",
    kind: "troop",
    cost: 1,
    count: 3,
    unit: {
      maxHp: 80,
      damage: 80,
      hitSpeed: 1.0,
      attackRange: MELEE,
      sightRange: 5.5,
      speed: "fast",
      targetsBuildingsOnly: false,
      radius: 0.3,
    },
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
  "skeletons",
  "arrows",
];

export function getCard(id: CardId): Card {
  return CARDS[id];
}
