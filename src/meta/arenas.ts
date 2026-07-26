/**
 * Trophy ladder arenas and per-card unlock thresholds.
 * Combat stats stay in src/game — this is meta identity + gate only.
 */
import { DEFAULT_DECK, type CardId } from "../game/cards";

export interface ArenaDef {
  id: string;
  name: string;
  /** Minimum trophies to stand in this arena. */
  trophies: number;
  /** Cards that become findable in chests at this arena. */
  unlocks: CardId[];
}

/** Ordered low → high. Last band is the cap (full pool). */
export const ARENAS: ArenaDef[] = [
  {
    id: "training-camp",
    name: "Training Camp",
    trophies: 0,
    unlocks: [...DEFAULT_DECK],
  },
  {
    id: "goblin-stadium",
    name: "Goblin Stadium",
    trophies: 100,
    unlocks: ["skeletons", "zap", "cannon"],
  },
  {
    id: "bone-pit",
    name: "Bone Pit",
    trophies: 200,
    unlocks: ["tombstone", "valkyrie", "bats"],
  },
  {
    id: "barbarian-bowl",
    name: "Barbarian Bowl",
    trophies: 400,
    unlocks: ["hog-rider", "wizard", "gargoyles"],
  },
  {
    id: "pekka-playhouse",
    name: "P.E.K.K.A's Playhouse",
    trophies: 700,
    unlocks: ["prince", "minions", "elixir-collector"],
  },
  {
    id: "spell-valley",
    name: "Spell Valley",
    trophies: 1000,
    unlocks: ["witch", "freeze", "rage"],
  },
  {
    id: "builders-workshop",
    name: "Builder's Workshop",
    trophies: 1300,
    unlocks: ["balloon", "royal-giant", "firecracker", "heal"],
  },
  {
    id: "royal-arena",
    name: "Royal Arena",
    trophies: 1600,
    unlocks: ["skeleton-army", "ice-wizard", "pekka", "tornado"],
  },
  {
    id: "frozen-peak",
    name: "Frozen Peak",
    trophies: 2000,
    unlocks: ["electro-wizard", "magic-archer", "princess"],
  },
  {
    id: "jungle-arena",
    name: "Jungle Arena",
    trophies: 2400,
    unlocks: ["executioner", "mega-knight", "skeleton-barrel"],
  },
  {
    id: "legendary-peak",
    name: "Legendary Peak",
    trophies: 3000,
    unlocks: [],
  },
];

/** Trophy threshold at which each card becomes findable. */
export const CARD_UNLOCK_TROPHIES: Record<CardId, number> = (() => {
  const out = {} as Record<CardId, number>;
  for (const arena of ARENAS) {
    for (const id of arena.unlocks) out[id] = arena.trophies;
  }
  return out;
})();

/** Arena the player currently stands in (highest band they qualify for). */
export function arenaForTrophies(trophies: number): ArenaDef {
  let current = ARENAS[0];
  for (const a of ARENAS) {
    if (trophies >= a.trophies) current = a;
  }
  return current;
}

/** Next arena above the current band, or null at the peak. */
export function nextArena(trophies: number): ArenaDef | null {
  const cur = arenaForTrophies(trophies);
  const i = ARENAS.findIndex((a) => a.id === cur.id);
  return i >= 0 && i < ARENAS.length - 1 ? ARENAS[i + 1] : null;
}

/** Progress 0–1 toward the next arena (1 at peak). */
export function trophyProgress(trophies: number): {
  current: ArenaDef;
  next: ArenaDef | null;
  intoBand: number;
  bandSize: number;
  ratio: number;
} {
  const current = arenaForTrophies(trophies);
  const next = nextArena(trophies);
  if (!next) {
    return { current, next: null, intoBand: 0, bandSize: 0, ratio: 1 };
  }
  const intoBand = trophies - current.trophies;
  const bandSize = next.trophies - current.trophies;
  return {
    current,
    next,
    intoBand,
    bandSize,
    ratio: Math.min(1, Math.max(0, intoBand / bandSize)),
  };
}

/** Cards findable in chests / usable once owned at this trophy count. */
export function cardsAvailableAt(trophies: number): CardId[] {
  return (Object.keys(CARD_UNLOCK_TROPHIES) as CardId[]).filter(
    (id) => CARD_UNLOCK_TROPHIES[id] <= trophies,
  );
}

export function unlockTrophiesFor(id: CardId): number {
  return CARD_UNLOCK_TROPHIES[id] ?? 0;
}

export function arenaNameForUnlock(id: CardId): string {
  const need = unlockTrophiesFor(id);
  const arena = ARENAS.find((a) => a.trophies === need) ?? ARENAS[0];
  return arena.name;
}
