/**
 * TEAM RULE of the cast (art bible 6), as data the bake and the tests share:
 *
 * - team colour goes ONLY on the largest back-visible cloth (cape, mantle,
 *   hood or tabard), plus the team disc;
 * - signature colours are fixed per card and never change with the team;
 * - no signature colour falls in either team's hue family: within 25° of a
 *   team hue at saturation above 0.45 and lightness 0.25-0.75. Skin tones
 *   are not signature colours (warm skin sits near red's hue by nature).
 */
import * as THREE from "three";
import { TEAM } from "../teamColors";
import type { FileId, Paint, Swatch, Variant } from "./types";

/**
 * The palette swatches of each body that are CLOTH a team colour may go on
 * (the knight's tabard, the rogues' hood-and-cape green, the mage's cape).
 * A variant's `paint` may say "team" only on these.
 */
export const CLOTH_SWATCHES: Partial<Record<FileId, Swatch[]>> = {
  knight: ["0,1"],
  mage: ["2,1"],
  rogue: ["1,1"],
  rogue_hooded: ["1,1"],
  barbarian: [],
  skeleton_minion: [],
};

/** Whole meshes a variant may paint in the team colour. */
export const CLOTH_MESH = /Cape|Cloak/;

/** Skin swatches of the human palettes (repainted with the variant's skin tone). */
export const SKIN_SWATCHES: Partial<Record<FileId, Swatch[]>> = {
  knight: ["0,0"],
  barbarian: ["0,0"],
  mage: ["0,0", "7,2"],
  rogue: ["0,0"],
  rogue_hooded: ["0,0"],
};

/** The hair swatch of each body (its back is repainted under hats and hoods, see Variant.hairBack). */
export const HAIR_SWATCH: Partial<Record<FileId, Swatch>> = {
  knight: "1,0",
  barbarian: "1,0",
  mage: "1,0",
  rogue: "1,0",
  rogue_hooded: "1,0",
};

/** Degrees either side of a team hue that a signature colour must stay out of. */
export const TEAM_HUE_SPREAD = 25;

const HSL = { h: 0, s: 0, l: 0 };

/** The team hues (degrees) of the default palette: blue and red. */
export function teamHues(): number[] {
  const out: number[] = [];
  for (const side of ["player", "enemy"] as const) {
    new THREE.Color().setHex(TEAM.default[side].main).getHSL(HSL, THREE.SRGBColorSpace);
    out.push(HSL.h * 360);
  }
  return out;
}

/** True when a colour would read as a team colour (art bible 6: the forbidden hue families). */
export function inTeamFamily(hex: number, hues = teamHues()): boolean {
  new THREE.Color().setHex(hex).getHSL(HSL, THREE.SRGBColorSpace);
  if (HSL.s <= 0.45 || HSL.l < 0.25 || HSL.l > 0.75) return false;
  const h = HSL.h * 360;
  return hues.some((t) => {
    const d = Math.abs(h - t) % 360;
    return Math.min(d, 360 - d) <= TEAM_HUE_SPREAD;
  });
}

/** Every rule a variant breaks (empty when it is clean). Used by the tests and a DEV check at bake. */
export function teamRuleViolations(id: string, v: Variant): string[] {
  const out: string[] = [];
  const hues = teamHues();
  const cloth = new Set(CLOTH_SWATCHES[v.file] ?? []);
  const isTeam = (p: Paint | undefined): boolean => p === "team" || p === "teamDark";
  if (v.team && !CLOTH_MESH.test(v.team.source)) out.push(`${id}: team mesh test ${v.team} is not cloth`);
  for (const [k, p] of Object.entries(v.paint ?? {})) {
    if (isTeam(p as Paint) && !cloth.has(k as Swatch)) out.push(`${id}: team paint on non-cloth swatch ${k}`);
    if (typeof p === "number" && inTeamFamily(p, hues)) out.push(`${id}: signature ${hex(p)} on ${k} is a team colour`);
  }
  for (const [k, p] of Object.entries(v.propPaint ?? {})) {
    if (isTeam(p as Paint)) out.push(`${id}: team paint on a borrowed prop swatch ${k}`);
    if (typeof p === "number" && inTeamFamily(p, hues)) out.push(`${id}: prop signature ${hex(p)} on ${k} is a team colour`);
  }
  (v.extras ?? []).forEach((x, i) => {
    if (isTeam(x.color) && !x.cloth) out.push(`${id}: extra #${i} on ${x.bone} is team-painted but not cloth`);
    if (typeof x.color === "number" && inTeamFamily(x.color, hues)) out.push(`${id}: extra #${i} ${hex(x.color)} is a team colour`);
  });
  return out;
}

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
