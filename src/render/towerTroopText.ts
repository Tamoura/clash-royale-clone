/**
 * Tower troop names and blurbs as the screen shows them. The troop data
 * (src/game/towers.ts) is part of the locked sim; this layer swaps in the
 * display wording by troop id. The ids never change: they are stored in
 * 'cr-clone-tower-troop' and sent in the online loadout.
 */
import { TOWER_TROOPS, type TowerTroopId } from "../game/towers";
import { ARABIC } from "../render3d/theme";

interface TroopWords {
  name?: string;
  ar?: string;
  blurb?: string;
  blurbAr?: string;
}

const OVERRIDES: Readonly<Partial<Record<TowerTroopId, TroopWords>>> = {
  // "Dagger Duchess" is another game's coined name, and "deadly" is rough
  // for ages 6-12.
  duchess: {
    name: "Swift Duchess",
    ar: "الدوقة السريعة",
    blurb: "A burst of 8 fast daggers, then a steady reload — a strong start.",
    blurbAr: "دفعة من ٨ خناجر سريعة ثم إعادة تعبئة متواصلة — بداية قوية.",
  },
};

/** The tower troop's name in an edition (`arabic`: the Golden Age edition). */
export function towerTroopNameIn(id: TowerTroopId, arabic: boolean): string {
  const d = TOWER_TROOPS[id];
  const o = OVERRIDES[id];
  return arabic ? (o?.ar ?? d.ar) : (o?.name ?? d.name);
}

/** The tower troop's blurb in an edition. */
export function towerTroopBlurbIn(id: TowerTroopId, arabic: boolean): string {
  const d = TOWER_TROOPS[id];
  const o = OVERRIDES[id];
  return arabic ? (o?.blurbAr ?? d.blurbAr) : (o?.blurb ?? d.blurb);
}

/** The tower troop's name in the edition being played. */
export const towerTroopName = (id: TowerTroopId): string => towerTroopNameIn(id, ARABIC);

/** The tower troop's blurb in the edition being played. */
export const towerTroopBlurb = (id: TowerTroopId): string => towerTroopBlurbIn(id, ARABIC);
