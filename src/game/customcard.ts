/**
 * Character Studio: the player-designed "champion" card.
 *
 * The player picks stats, capabilities, and a look; the elixir cost is not
 * chosen but COMPUTED from what the design can do, using a pricing model
 * calibrated against the built-in roster (see customcard.test.ts). The saved
 * design is written through into CARDS["champion"] so the sim, bot, HUD,
 * portraits and renderer all see it via the normal card lookup.
 */
import { CARDS, type CardId, type Speed, type TroopCard } from "./cards";

export const CHAMPION_ID: CardId = "champion";

/** Cosmetic options — purely visual, never priced. */
export type Headgear = "none" | "helmet" | "hood" | "crown" | "horns" | "turban";
export type WeaponKind = "sword" | "axe" | "hammer" | "spear" | "bow" | "staff" | "none";
export type FaceMood = "brave" | "angry" | "cute" | "wicked" | "calm";

export interface ChampionLook {
  /** Main outfit color (hex int). */
  body: number;
  /** Trim / armor accent color (hex int). */
  trim: number;
  headgear: Headgear;
  weapon: WeaponKind;
  mood: FaceMood;
}

/** Capabilities that shape gameplay — each one is priced. */
export interface ChampionAbilities {
  /** Flies: straight paths, only hit by air-targeters. */
  flying: boolean;
  /** Attacks can hit flying troops. */
  targetsAir: boolean;
  /** Attacks splash around the struck target. */
  splash: boolean;
  /** Uninterrupted approach charges a 2x hit. */
  charge: boolean;
  /** Hits briefly stun the target. */
  stun: boolean;
  /** Hits chill the target (slower move + attack). */
  chill: boolean;
  /** Ranged shots pierce everything along the line (needs range). */
  pierce: boolean;
  /** Leaps the river instead of detouring to a bridge. */
  jumpsRiver: boolean;
  /** Explodes on death, damaging nearby enemies. */
  deathBomb: boolean;
  /**
   * Ignores troops and marches straight for buildings (Giant-style).
   * A restriction, so it's the one capability that LOWERS the price.
   */
  buildingsOnly: boolean;
  /** Periodically summons a wave of skeletons (Witch-style). */
  summoner: boolean;
}

export interface ChampionDef {
  name: string;
  /** Units per deploy. */
  count: number;
  /** HP per unit. */
  hp: number;
  /** Damage per hit. */
  damage: number;
  /** Seconds between hits. */
  hitSpeed: number;
  /** 0.8 = melee; anything above 1 is a ranged attack (tiles). */
  range: number;
  speed: Speed;
  abilities: ChampionAbilities;
  look: ChampionLook;
}

/** Hard limits the Studio (and normalization) clamp to. */
export const CHAMPION_LIMITS = {
  count: { min: 1, max: 5 },
  hp: { min: 100, max: 3600 },
  damage: { min: 40, max: 700 },
  hitSpeed: { min: 0.9, max: 2.6 },
  range: { min: 0.8, max: 8 },
  nameLength: 14,
} as const;

/** Swatches offered by the Studio (body & trim). */
export const CHAMPION_PALETTE: number[] = [
  0x2f6bd8, 0x1aa3a0, 0x1f7a52, 0x57a83f, 0xb85c38, 0xc23b3b, 0x8e24aa,
  0x5e35b1, 0xf2c14e, 0xe8846b, 0x37474f, 0x8d6e63,
];

export const DEFAULT_CHAMPION: ChampionDef = {
  name: "Champion",
  count: 1,
  hp: 1200,
  damage: 180,
  hitSpeed: 1.3,
  range: 0.8,
  speed: "medium",
  abilities: {
    flying: false,
    targetsAir: false,
    splash: false,
    charge: false,
    stun: false,
    chill: false,
    pierce: false,
    jumpsRiver: false,
    deathBomb: false,
    buildingsOnly: false,
    summoner: false,
  },
  // Deliberately NOT the Knight formula (blue + helmet + sword): the
  // default champion reads as its own hero even before the player edits it.
  look: {
    body: 0x8a3fc2,
    trim: 0x5ad7c8,
    headgear: "horns",
    weapon: "hammer",
    mood: "angry",
  },
};

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * Clamp a (possibly hand-edited / stale) design into legal bounds so the
 * computed cost always matches what actually enters the battle.
 */
export function normalizeChampion(raw: unknown): ChampionDef {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<ChampionDef>;
  const a = (d.abilities ?? {}) as Partial<ChampionAbilities>;
  const l = (d.look ?? {}) as Partial<ChampionLook>;
  const L = CHAMPION_LIMITS;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const range = clamp(num(d.range, DEFAULT_CHAMPION.range), L.range.min, L.range.max);
  const speed: Speed =
    d.speed === "slow" || d.speed === "fast" ? d.speed : "medium";
  const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    name:
      (typeof d.name === "string" && d.name.trim().slice(0, L.nameLength)) ||
      DEFAULT_CHAMPION.name,
    count: Math.round(clamp(num(d.count, 1), L.count.min, L.count.max)),
    hp: Math.round(clamp(num(d.hp, DEFAULT_CHAMPION.hp), L.hp.min, L.hp.max)),
    damage: Math.round(
      clamp(num(d.damage, DEFAULT_CHAMPION.damage), L.damage.min, L.damage.max),
    ),
    hitSpeed: clamp(num(d.hitSpeed, DEFAULT_CHAMPION.hitSpeed), L.hitSpeed.min, L.hitSpeed.max),
    // Ranges between melee and true reach snap to melee: 0.8 or 3+.
    range: range > 1 ? Math.max(3, Math.round(range)) : 0.8,
    speed,
    abilities: {
      flying: a.flying === true,
      targetsAir: a.targetsAir === true,
      splash: a.splash === true,
      charge: a.charge === true,
      stun: a.stun === true,
      chill: a.chill === true,
      // Piercing is a property of a ranged shot; melee designs can't buy it.
      pierce: a.pierce === true && range > 1,
      jumpsRiver: a.jumpsRiver === true && a.flying !== true,
      deathBomb: a.deathBomb === true,
      buildingsOnly: a.buildingsOnly === true,
      summoner: a.summoner === true,
    },
    look: {
      body: num(l.body, DEFAULT_CHAMPION.look.body) & 0xffffff,
      trim: num(l.trim, DEFAULT_CHAMPION.look.trim) & 0xffffff,
      headgear: pick(l.headgear, ["none", "helmet", "hood", "crown", "horns", "turban"] as const, "helmet"),
      weapon: pick(l.weapon, ["sword", "axe", "hammer", "spear", "bow", "staff", "none"] as const, "sword"),
      mood: pick(l.mood, ["brave", "angry", "cute", "wicked", "calm"] as const, "brave"),
    },
  };
}

/** Speed is a force multiplier on everything the unit does. */
const SPEED_FACTOR: Record<Speed, number> = { slow: 0.92, medium: 1, fast: 1.1 };

/**
 * Priced capability surcharges (multiplicative, summed). Building-hunting
 * is negative: refusing to fight troops is a restriction, so it discounts
 * the price the way Giants and Hogs undercut equal-stat all-rounders.
 */
const ABILITY_SURCHARGE: Record<keyof ChampionAbilities, number> = {
  flying: 0.12,
  targetsAir: 0.1,
  splash: 0.18,
  charge: 0.08,
  stun: 0.22,
  chill: 0.1,
  pierce: 0.12,
  jumpsRiver: 0.04,
  deathBomb: 0.08,
  buildingsOnly: -0.12,
  summoner: 0.25,
};

/** The dearest card the elixir bar can ever pay for. */
export const MAX_CHAMPION_COST = 10;

/**
 * Raw (unclamped) power score of a design — the price it WOULD cost if
 * elixir had no ceiling.
 *
 * Offense = dps scaled by reach and (sub-linearly) by unit count — swarms
 * trade total damage for splash vulnerability, like CR's cheap hordes.
 * Defense = total HP on the field. Capabilities add percentage surcharges.
 * Calibrated so the built-in troops price within ±1 of their real cost.
 */
function championScore(def: ChampionDef): number {
  const dps = def.damage / def.hitSpeed;
  const rangeFactor = def.range <= 1 ? 1 : 1 + (def.range - 1) * 0.06;
  const offense = (dps / 95) * Math.sqrt(def.count) * rangeFactor;
  const defense = (def.hp * def.count) / 1050;
  let surcharge = 1;
  for (const key of Object.keys(ABILITY_SURCHARGE) as (keyof ChampionAbilities)[]) {
    if (def.abilities[key]) surcharge += ABILITY_SURCHARGE[key];
  }
  return (offense + defense) * SPEED_FACTOR[def.speed] * surcharge;
}

export interface ChampionCostInfo {
  /** Playable price (1..MAX_CHAMPION_COST). */
  cost: number;
  /** Honest price with no ceiling — what the design is really worth. */
  raw: number;
  /**
   * True when raw exceeds the elixir bar: the design is TOO powerful to
   * price fairly, so it cannot be saved (the guardrail — a 23-worth
   * monster must not sneak onto the field at 10).
   */
  overBudget: boolean;
}

export function championCostInfo(def: ChampionDef): ChampionCostInfo {
  const raw = Math.max(1, Math.round(championScore(def)));
  return {
    cost: Math.min(raw, MAX_CHAMPION_COST),
    raw,
    overBudget: raw > MAX_CHAMPION_COST,
  };
}

/** Playable elixir price of a design (see championCostInfo for the raw score). */
export function championElixirCost(def: ChampionDef): number {
  return championCostInfo(def).cost;
}

/**
 * Scale an over-budget design's HP and damage down until it prices within
 * the elixir bar. Used when loading a save that predates the guardrail
 * (or was hand-edited) so nothing over-powered ever enters a battle.
 */
export function fitChampionToBudget(def: ChampionDef): ChampionDef {
  let d = normalizeChampion(def);
  for (let i = 0; i < 80 && championCostInfo(d).overBudget; i++) {
    d = normalizeChampion({ ...d, hp: d.hp * 0.94, damage: d.damage * 0.94 });
  }
  return d;
}

/** Materialize the design as a playable troop card (cost included). */
export function buildChampionCard(raw: ChampionDef): TroopCard {
  const def = normalizeChampion(raw);
  const ab = def.abilities;
  const ranged = def.range > 1;
  return {
    id: CHAMPION_ID,
    name: def.name,
    rarity: "epic",
    kind: "troop",
    cost: championElixirCost(def),
    count: def.count,
    unit: {
      maxHp: def.hp,
      damage: def.damage,
      hitSpeed: def.hitSpeed,
      attackRange: def.range,
      sightRange: Math.max(5.5, def.range + 0.5),
      speed: def.speed,
      targetsBuildingsOnly: ab.buildingsOnly,
      targetsAir: ab.targetsAir,
      flying: ab.flying,
      jumpsRiver: ab.jumpsRiver,
      splashRadius: ab.splash ? 1.1 : 0,
      chargeDistance: ab.charge ? 2.5 : 0,
      pierce: ranged && ab.pierce,
      recoil: 0,
      stunOnHit: ab.stun ? 0.6 : 0,
      slowOnHit: ab.chill ? 2 : 0,
      chainCount: 1,
      splashDamageFactor: 1,
      jumpRange: 0,
      deathDamage: ab.deathBomb ? Math.round(def.damage * 0.8) : 0,
      deathRadius: ab.deathBomb ? 1.5 : 0,
      spawnUnitId: ab.summoner ? "skeletons" : null,
      spawnInterval: ab.summoner ? 7 : 0,
      elixirInterval: 0,
      radius: def.count > 1 ? 0.4 : 0.55,
    },
  };
}

/**
 * Write the design through into the shared CARDS record so every consumer
 * (sim, bot, HUD, portraits, Crazy-mode scrambling) sees it.
 */
export function applyChampion(def: ChampionDef): TroopCard {
  const card = buildChampionCard(def);
  Object.assign(CARDS[CHAMPION_ID], card);
  return card;
}

export const CHAMPION_STORAGE_KEY = "cr-clone-champion";

/**
 * The saved design, or the default when unset/corrupt (node-safe).
 * Always budget-fitted: an over-powered save is scaled down, never
 * allowed onto the field under-priced.
 */
export function loadChampion(): ChampionDef {
  try {
    const raw = localStorage.getItem(CHAMPION_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CHAMPION);
    return fitChampionToBudget(JSON.parse(raw) as ChampionDef);
  } catch {
    return structuredClone(DEFAULT_CHAMPION);
  }
}

/** True once the player has saved a design (champion becomes playable). */
export function hasSavedChampion(): boolean {
  try {
    return localStorage.getItem(CHAMPION_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Persist + apply a design; returns the materialized card, or null when
 * the design is over budget (too powerful for the elixir bar) — the
 * guardrail refuses to save it rather than under-price it.
 */
export function saveChampion(def: ChampionDef): TroopCard | null {
  const clean = normalizeChampion(def);
  if (championCostInfo(clean).overBudget) return null;
  try {
    localStorage.setItem(CHAMPION_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // storage unavailable (private mode / node) — still apply in-memory
  }
  return applyChampion(clean);
}

/**
 * Delete the (single) champion: clear the save and reset the shared card
 * to the neutral default. Callers also revoke ownership / deck slots.
 */
export function deleteChampion(): void {
  try {
    localStorage.removeItem(CHAMPION_STORAGE_KEY);
  } catch {
    // storage unavailable — in-memory reset still happens
  }
  applyChampion(structuredClone(DEFAULT_CHAMPION));
}

/** Boot hook: make the saved design live before any UI renders. */
export function initChampion(): void {
  applyChampion(loadChampion());
}
