import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { setPrefs } from "../ui/prefs";
import { TEAM, TEAM_MESH, applyTeam, isTeamPart, teamColor, teamCss, teamPart } from "./teamColors";

function part(shade?: "main" | "dark", name = ""): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshToonMaterial({ color: 0x777777 }));
  m.name = name;
  return shade ? teamPart(m, shade) : m;
}

describe("team colours", () => {
  afterEach(() => {
    setPrefs({ teamPalette: "default" });
  });

  it("has the specified default and colour-blind pairs", () => {
    expect(TEAM.default.player).toEqual({ main: 0x3b82f6, dark: 0x2463d6 });
    expect(TEAM.default.enemy).toEqual({ main: 0xe53935, dark: 0xb71c1c });
    expect(TEAM.cb.player).toEqual({ main: 0x2f80ff, dark: 0x1f5fcc });
    expect(TEAM.cb.enemy).toEqual({ main: 0xff8a00, dark: 0xcc6a00 });
  });

  it("teamColor follows the teamPalette pref", () => {
    expect(teamColor("enemy")).toBe(0xe53935);
    setPrefs({ teamPalette: "cb" });
    expect(teamColor("enemy")).toBe(0xff8a00);
    expect(teamColor("player", "dark")).toBe(0x1f5fcc);
    expect(teamCss("enemy", "dark")).toBe("#cc6a00");
    // An explicit palette wins over the pref.
    expect(teamColor("enemy", "main", "default")).toBe(0xe53935);
  });

  it("teamPart names the mesh 'team', records the shade and keeps the old name", () => {
    const m = part("dark", "headband");
    expect(m.name).toBe(TEAM_MESH);
    expect(m.userData.team).toBe("dark");
    expect(m.userData.part).toBe("headband");
    expect(isTeamPart(m)).toBe(true);
    expect(teamPart(part()).userData.team).toBe("main");
  });

  it("applyTeam tints only tagged meshes, per shade, and can repaint", () => {
    const root = new THREE.Group();
    const main = part("main");
    const dark = part("dark");
    const plain = part();
    root.add(main, plain);
    main.add(dark); // nested parts are found too
    applyTeam(root, "enemy");
    expect((main.material as THREE.MeshToonMaterial).color.getHex()).toBe(0xe53935);
    expect((dark.material as THREE.MeshToonMaterial).color.getHex()).toBe(0xb71c1c);
    expect((plain.material as THREE.MeshToonMaterial).color.getHex()).toBe(0x777777);
    applyTeam(root, "enemy", "cb");
    expect((main.material as THREE.MeshToonMaterial).color.getHex()).toBe(0xff8a00);
    applyTeam(root, "player");
    expect((main.material as THREE.MeshToonMaterial).color.getHex()).toBe(0x3b82f6);
  });
});
