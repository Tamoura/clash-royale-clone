/**
 * The Character Studio champion in the cast: a VARIANT generated from the
 * saved ChampionDef. Every headgear (helmet, hood, crown, horns, turban,
 * none) and weapon (sword, axe, hammer, spear, bow, staff, none) maps onto
 * kit props or our primitives; the player's outfit and trim colours become
 * the signature palette, nudged out of the team hue families if they fall
 * in one; the team colour goes on the cape. Flying champions stay on the
 * procedural rig (an explicit fallback: the cast has no wings).
 */
import * as THREE from "three";
import type { ChampionDef, Headgear, WeaponKind } from "../../game/customcard";
import { THEME } from "../theme";
import { ball, box, crown, cyl, inHand, scimitar, turban, turbanHelmet, x, HEAD_TOP } from "./props";
import { inTeamFamily, teamHues, TEAM_HUE_SPREAD } from "./rules";
import type { Edition, Extra, FileId, Swatch, Variant } from "./types";

const HSL = { h: 0, s: 0, l: 0 };

/** A player-picked colour kept out of both team hue families (hue pushed past the edge, or saturation cut). */
export function signatureSafe(hex: number): number {
  const hues = teamHues();
  if (!inTeamFamily(hex, hues)) return hex;
  const c = new THREE.Color().setHex(hex);
  c.getHSL(HSL, THREE.SRGBColorSpace);
  const h = HSL.h * 360;
  // The nearest team hue, and step to just past its edge on the side the colour leans.
  let best = hues[0];
  for (const t of hues) if (Math.abs(((h - t + 540) % 360) - 180) < Math.abs(((h - best + 540) % 360) - 180)) best = t;
  const d = ((h - best + 540) % 360) - 180;
  const out = (best + Math.sign(d || 1) * (TEAM_HUE_SPREAD + 6) + 360) % 360;
  c.setHSL(out / 360, HSL.s, HSL.l, THREE.SRGBColorSpace);
  const next = c.getHex(THREE.SRGBColorSpace);
  if (!inTeamFamily(next, hues)) return next;
  c.setHSL(HSL.h, 0.4, HSL.l, THREE.SRGBColorSpace);
  return c.getHex(THREE.SRGBColorSpace);
}

const FILE_OF: Record<Headgear, FileId> = {
  helmet: "knight",
  hood: "rogue_hooded",
  crown: "knight",
  horns: "barbarian",
  turban: "rogue",
  none: "rogue",
};

/** The outfit and trim swatches of each body. */
const OUTFIT: Partial<Record<FileId, Swatch>> = { knight: "0,1", rogue: "0,1", rogue_hooded: "0,1", barbarian: "0,1" };
const TRIM: Partial<Record<FileId, Swatch>> = { knight: "7,0", rogue: "3,0", rogue_hooded: "3,0", barbarian: "1,1" };

const ATTACK: Record<WeaponKind, string> = {
  sword: "1H_Melee_Attack_Chop",
  axe: "1H_Melee_Attack_Chop",
  hammer: "1H_Melee_Attack_Chop",
  spear: "1H_Melee_Attack_Stab",
  bow: "1H_Ranged_Shoot",
  staff: "Spellcast_Shoot",
  none: "Unarmed_Melee_Attack_Punch_A",
};

function weaponProps(w: WeaponKind, edition: Edition): { props: string[]; extras: Extra[] } {
  switch (w) {
    case "sword":
      return edition === "golden" ? { props: [], extras: scimitar() } : { props: ["knight:1H_Sword"], extras: [] };
    case "axe":
      return { props: ["barbarian:1H_Axe"], extras: [] };
    case "staff":
      return { props: ["mage:2H_Staff"], extras: [] };
    case "hammer":
      return { props: [], extras: [inHand(0x6d4c41, () => cyl(0.05, 0.05, 1.0, 0, 0.35, 0, 8)), inHand(0x9aa3ad, () => box(0.3, 0.26, 0.46, 0, 0.9, 0))] };
    case "spear":
      return { props: [], extras: [inHand(0x8a5a2e, () => cyl(0.045, 0.05, 2.0, 0, 0.55, 0, 6)), inHand(0xd8e2ec, () => cyl(0.0, 0.1, 0.32, 0, 1.7, 0, 6))] };
    case "bow":
      return {
        props: [],
        extras: [inHand(0x8a5a2e, () => new THREE.TorusGeometry(0.64, 0.05, 5, 16, Math.PI * 0.85).rotateZ(Math.PI * 0.575).rotateY(Math.PI / 2).translate(0, 0.15, -0.2))],
      };
    default:
      return { props: [], extras: [] };
  }
}

function headgearExtras(g: Headgear, body: number, trim: number, edition: Edition): Extra[] {
  const gold = THEME.goldLight;
  switch (g) {
    case "crown":
      return edition === "golden" ? [...turban(0xf5f0e6, trim, HEAD_TOP - 0.2), ...crown(gold, 0.42, HEAD_TOP + 0.02)] : crown(gold, 0.42);
    case "turban":
      return turban(body, trim, HEAD_TOP - 0.18, 0.5, gold);
    case "helmet":
      return edition === "golden" ? turbanHelmet(0xc3ccd6, body, gold) : [x("head", trim, () => ball(0.12, 0, HEAD_TOP + 0.2, -0.05, 1, 2, 1.6, 10))];
    case "horns":
      return [
        x("head", 0xf2ead8, () => new THREE.ConeGeometry(0.12, 0.55, 8).rotateZ(-0.9).translate(0.6, HEAD_TOP - 0.02, 0)),
        x("head", 0xf2ead8, () => new THREE.ConeGeometry(0.12, 0.55, 8).rotateZ(0.9).translate(-0.6, HEAD_TOP - 0.02, 0)),
      ];
    case "none":
      return edition === "golden" ? turban(body, trim, HEAD_TOP - 0.18, 0.5) : [];
    default:
      return [];
  }
}

/** The champion's variant for its saved look, or null for a flyer (the procedural rig keeps it). */
export function championVariant(def: ChampionDef, edition: Edition): Variant | null {
  if (def.abilities.flying) return null;
  const { look } = def;
  const body = signatureSafe(look.body);
  const trim = signatureSafe(look.trim);
  const file = FILE_OF[look.headgear] ?? "rogue";
  const w = weaponProps(look.weapon, edition);
  const props = ["Knight_Cape", "Barbarian_Cape", "Rogue_Cape"].filter((p) => p.toLowerCase().startsWith(file.split("_")[0]));
  if (look.headgear === "helmet" && edition === "classic") props.push("Knight_Helmet");
  if (look.headgear === "horns") props.push("Barbarian_Hat");
  const paint: Variant["paint"] = {};
  if (OUTFIT[file]) paint[OUTFIT[file]!] = body;
  if (TRIM[file]) paint[TRIM[file]!] = trim;
  if (file === "rogue_hooded") paint["1,1"] = body;
  return {
    file,
    scale: def.count >= 4 ? 0.72 : def.count >= 2 ? 0.85 : 0.98,
    props: [...props, ...w.props],
    team: /Cape/,
    paint,
    hairBack: file === "rogue_hooded" ? "1,1" : undefined,
    extras: [...headgearExtras(look.headgear, body, trim, edition), ...w.extras],
    idle: "Idle",
    walk: "Walking_A",
    attack: ATTACK[look.weapon] ?? "1H_Melee_Attack_Chop",
    strike: look.weapon === "bow" ? 0.3 : 0.42,
    back: [`${look.headgear} headgear`, `${look.weapon} held out`, "team cape"],
  };
}

/** Cache key of a champion look (the bake is per look). */
export function championKey(def: ChampionDef, edition: Edition): string {
  const { look } = def;
  return `${edition}:champion:${look.headgear}:${look.weapon}:${look.body}:${look.trim}:${def.count >= 4 ? 4 : def.count >= 2 ? 2 : 1}`;
}
