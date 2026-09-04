/**
 * Tower Troops: the defender stationed on each princess tower. Picked per
 * side before a match; changes how the towers fight, not how much they
 * take. King towers always keep the King.
 */
export type TowerTroopId = "princess" | "cannoneer" | "duchess";

export interface TowerTroopDef {
  id: TowerTroopId;
  name: string;
  ar: string;
  blurb: string;
  blurbAr: string;
  damage: number;
  /** Seconds between shots. */
  hitSpeed: number;
  range: number;
  /** Area damage around the struck target; 0 = single target. */
  splashRadius: number;
  /** Shots in the magazine (0 = unlimited). */
  ammoMax: number;
  /** Seconds to reload one shot when below full. */
  reloadSeconds: number;
}

export const TOWER_TROOPS: Record<TowerTroopId, TowerTroopDef> = {
  princess: {
    id: "princess",
    name: "Princess",
    ar: "الأميرة",
    blurb: "Steady arrows — the all-rounder.",
    blurbAr: "سهام ثابتة — الخيار المتوازن.",
    damage: 120,
    hitSpeed: 0.8,
    range: 7.5,
    splashRadius: 0,
    ammoMax: 0,
    reloadSeconds: 0,
  },
  cannoneer: {
    id: "cannoneer",
    name: "Cannoneer",
    ar: "المدفعي",
    blurb: "Slow, heavy shells that splash — punishes swarms and tanks.",
    blurbAr: "قذائف ثقيلة بطيئة ذات انفجار — تعاقب الأسراب والدروع.",
    damage: 330,
    hitSpeed: 2.4,
    range: 7.0,
    splashRadius: 1.0,
    ammoMax: 0,
    reloadSeconds: 0,
  },
  duchess: {
    id: "duchess",
    name: "Dagger Duchess",
    ar: "دوقة الخناجر",
    blurb: "A burst of 8 fast daggers, then a slow reload — deadly opener.",
    blurbAr: "دفعة من ٨ خناجر سريعة ثم إعادة تعبئة بطيئة — افتتاح قاتل.",
    damage: 70,
    hitSpeed: 0.3,
    range: 7.0,
    splashRadius: 0,
    ammoMax: 8,
    reloadSeconds: 1.1,
  },
};

export const TOWER_TROOP_IDS: TowerTroopId[] = ["princess", "cannoneer", "duchess"];

export const TOWER_TROOP_KEY = "cr-clone-tower-troop";

export function isTowerTroopId(v: unknown): v is TowerTroopId {
  return v === "princess" || v === "cannoneer" || v === "duchess";
}

/** The player's saved choice (Princess until they pick). Node-safe. */
export function loadTowerTroop(): TowerTroopId {
  try {
    const v = localStorage.getItem(TOWER_TROOP_KEY);
    return isTowerTroopId(v) ? v : "princess";
  } catch {
    return "princess";
  }
}

export function saveTowerTroop(id: TowerTroopId): void {
  try {
    localStorage.setItem(TOWER_TROOP_KEY, id);
  } catch {
    // storage unavailable
  }
}
