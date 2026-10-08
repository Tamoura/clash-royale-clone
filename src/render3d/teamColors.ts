import * as THREE from "three";
import type { Side } from "../game/arena";
import { getPrefs, type TeamPalette } from "../ui/prefs";

/**
 * Team identity colours for unit bodies, team discs and side-tinted HUD
 * bits. Rigs are built in neutral palettes and tag 1-3 large readable
 * parts (tabard, cape, plume, sash, shield face, hat band...) with
 * teamPart(); applyTeam() then paints those parts for one side. The
 * player's teamPalette pref swaps red for orange (blue/orange stays
 * distinct under the common colour-vision deficiencies).
 *
 * Contract (wave 3 relies on it): team parts are separate meshes named
 * "team" with userData.team = shade, never merged into batched geometry. A
 * baked rig (rigBake.ts) merges a node's team parts into one "team" mesh:
 * userData.team is then "both" when it holds both shades, whose dark parts
 * read the material's userData.teamDark colour.
 */

export type TeamShade = "main" | "dark";

export const TEAM: Readonly<Record<TeamPalette, Record<Side, Record<TeamShade, number>>>> = {
  default: {
    player: { main: 0x3b82f6, dark: 0x2463d6 },
    enemy: { main: 0xe53935, dark: 0xb71c1c },
  },
  cb: {
    player: { main: 0x2f80ff, dark: 0x1f5fcc },
    enemy: { main: 0xff8a00, dark: 0xcc6a00 },
  },
};

/** Mesh name every team-tinted part carries. */
export const TEAM_MESH = "team";

/** The active palette: the player's pref, 'default' when unreadable. */
export function teamPalette(): TeamPalette {
  try {
    return getPrefs().teamPalette;
  } catch {
    return "default";
  }
}

/** Hex colour for a side and shade in the given (default: active) palette. */
export function teamColor(
  side: Side,
  shade: TeamShade = "main",
  palette: TeamPalette = teamPalette(),
): number {
  return TEAM[palette][side][shade];
}

/** CSS "#rrggbb" form of teamColor, for canvas drawing. */
export function teamCss(side: Side, shade: TeamShade = "main", palette?: TeamPalette): string {
  return "#" + teamColor(side, shade, palette).toString(16).padStart(6, "0");
}

/**
 * Tag a rig mesh as a team part. Its build colour is only a placeholder:
 * applyTeam() repaints it. Any descriptive name it had is kept in
 * userData.part so signature-prop lookups still find it.
 */
export function teamPart<T extends THREE.Mesh>(mesh: T, shade: TeamShade = "main"): T {
  if (mesh.name && mesh.name !== TEAM_MESH) mesh.userData.part = mesh.name;
  mesh.name = TEAM_MESH;
  mesh.userData.team = shade;
  return mesh;
}

/** True for a mesh tagged by teamPart(). */
export function isTeamPart(o: THREE.Object3D): boolean {
  return (o as THREE.Mesh).isMesh === true && o.name === TEAM_MESH;
}

/**
 * Paint every team part under `root` for `side`. Materials are per mesh
 * (toon() never shares), so tinting one unit never bleeds into another.
 * Safe to call again (palette change, ghost clones).
 */
export function applyTeam(root: THREE.Object3D, side: Side, palette: TeamPalette = teamPalette()): void {
  root.traverse((o) => {
    if (!isTeamPart(o)) return;
    const mesh = o as THREE.Mesh;
    const shade: TeamShade = mesh.userData.team === "dark" ? "dark" : "main";
    const hex = teamColor(side, shade, palette);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const c = (m as THREE.Material & { color?: THREE.Color }).color;
      if (c) c.setHex(hex);
      const dark = m.userData.teamDark as THREE.Color | undefined;
      if (dark) dark.setHex(teamColor(side, "dark", palette));
    }
  });
}
