import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CLASSIC } from "./variants.classic";
import { GOLDEN } from "./variants.golden";
import { CLOTH_MESH, CLOTH_SWATCHES, HAIR_SWATCH, SKIN_SWATCHES, inTeamFamily, teamHues, teamRuleViolations } from "./rules";
import { MESH_SWATCHES, MESH_VERTS, SWATCH_HEX } from "./palettes";
import { BONES, BONE_INDEX, clips, type Source } from "./loader";
import { LEAN, LEAN_DEG, SWARM_SHARE, joinSwarm, leanQuaternion, mixerHz, swarmLeader, swarmSize } from "./animate";
import { championVariant, signatureSafe } from "./champion";
import { makeUnit } from "./unit";
import { gradeHsl, type Baked } from "./bake";
import type { Edition, Variant } from "./types";
import { DEFAULT_CHAMPION } from "../../game/customcard";
import { disposeDeep } from "../scene/common";

const EDITIONS: [Edition, Record<string, Variant>][] = [
  ["classic", CLASSIC],
  ["golden", GOLDEN],
];

/** Body vertices a variant bakes (body meshes, props, our primitives), before the ink shell doubles them. */
function bodyVertices(v: Variant): number {
  let n = 0;
  for (const [mesh, count] of Object.entries(MESH_VERTS[v.file])) {
    const skinned = /_(Arm|Leg|Body|Head|Cloak|Eyes|Jaw)/.test(mesh);
    if (skinned && !v.drop?.test(mesh)) n += count;
  }
  for (const p of v.props) {
    const [file, node] = p.includes(":") ? p.split(":") : [v.file, p];
    n += MESH_VERTS[file]?.[node] ?? 0;
  }
  for (const x of v.extras ?? []) n += x.geo().getAttribute("position").count;
  return n;
}

/** The grade the bake gives an unrepainted swatch (bake.ts gradeHsl), as sRGB hex. */
function graded(hex: number): number {
  const c = new THREE.Color().setHex(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  const g = gradeHsl(hsl.h, hsl.s, hsl.l, { h: 0, s: 0, l: 0 });
  return c.setHSL(g.h, g.s, g.l, THREE.SRGBColorSpace).getHex(THREE.SRGBColorSpace);
}

describe("cast bake budget", () => {
  it("rigs on the shared 23-bone skeleton", () => {
    expect(BONES.length).toBe(23);
    expect(new Set(BONES).size).toBe(23);
  });

  it("every variant bakes under the vertex cap (one skinned draw, ink shell included)", () => {
    for (const [ed, roster] of EDITIONS) {
      for (const [id, v] of Object.entries(roster)) {
        const verts = bodyVertices(v);
        expect(verts, `${ed}:${id}`).toBeGreaterThan(1500);
        expect(verts, `${ed}:${id}`).toBeLessThanOrEqual(9000);
      }
    }
  });

  it("only uses props the pack keeps and bones the rig has", () => {
    for (const [ed, roster] of EDITIONS) {
      for (const [id, v] of Object.entries(roster)) {
        for (const p of v.props) {
          const [file, node] = p.includes(":") ? p.split(":") : [v.file, p];
          expect(MESH_VERTS[file]?.[node], `${ed}:${id} prop ${p}`).toBeGreaterThan(0);
        }
        for (const x of v.extras ?? []) expect(BONE_INDEX.has(x.bone), `${ed}:${id} bone ${x.bone}`).toBe(true);
      }
    }
  });
});

describe("cast team rule", () => {
  it("knows the team hues (blue and red)", () => {
    const [blue, red] = teamHues();
    expect(blue).toBeGreaterThan(200);
    expect(blue).toBeLessThan(230);
    expect(Math.min(red, 360 - red)).toBeLessThan(10);
    expect(inTeamFamily(0x2463d6)).toBe(true); // a navy that reads as the blue team
    expect(inTeamFamily(0xe34a4d)).toBe(true); // the packs' knight red
    expect(inTeamFamily(0x1f9e8f)).toBe(false); // the wizard's teal
    expect(inTeamFamily(0xb4c0d0)).toBe(false); // steel grey
  });

  it("no variant breaks it (team paint on cloth only, no signature in a team hue family)", () => {
    for (const [ed, roster] of EDITIONS) {
      for (const [id, v] of Object.entries(roster)) expect(teamRuleViolations(`${ed}:${id}`, v)).toEqual([]);
    }
  });

  it("every swatch a variant actually shows is outside the team families unless it is team cloth", () => {
    for (const [ed, roster] of EDITIONS) {
      for (const [id, v] of Object.entries(roster)) {
        const used = new Set<string>();
        for (const [mesh, swatches] of Object.entries(MESH_SWATCHES[v.file])) {
          const skinned = /_(Arm|Leg|Body|Head|Cloak|Eyes|Jaw)/.test(mesh);
          const worn = skinned ? !v.drop?.test(mesh) : v.props.includes(mesh);
          if (!worn || v.team?.test(mesh)) continue; // a whole team mesh is cloth by CLOTH_MESH
          for (const s of swatches) used.add(s);
        }
        const skin = new Set<string>(SKIN_SWATCHES[v.file] ?? []);
        for (const s of used) {
          if (skin.has(s)) continue;
          const paint = v.paint?.[s as `${number},${number}`];
          if (paint === "team" || paint === "teamDark") {
            expect(CLOTH_SWATCHES[v.file], `${ed}:${id} team on ${s}`).toContain(s);
            continue;
          }
          const [c, r] = s.split(",").map(Number);
          const hex = typeof paint === "number" ? paint : graded(SWATCH_HEX[v.file][r][c]);
          expect(inTeamFamily(hex), `${ed}:${id} swatch ${s} #${hex.toString(16)}`).toBe(false);
        }
      }
    }
  });

  it("capes and cloaks are the only whole meshes painted team", () => {
    for (const [, roster] of EDITIONS) {
      for (const v of Object.values(roster)) if (v.team) expect(CLOTH_MESH.test(v.team.source)).toBe(true);
    }
  });

  it("keeps a Studio colour out of the team families", () => {
    for (const hex of [0x3b82f6, 0x2463d6, 0xe53935, 0xff2020, 0x1f8f86]) {
      expect(inTeamFamily(signatureSafe(hex))).toBe(false);
    }
    expect(signatureSafe(0x1f8f86)).toBe(0x1f8f86);
  });
});

/** Humanoid cards of each edition (the cast must cover them) and the explicit fallbacks. */
const HUMANOIDS = [
  "knight", "archers", "firecracker", "magic-archer", "musketeer", "mini-pekka", "skeletons", "skeleton-army",
  "wizard", "witch", "executioner", "electro-wizard", "ice-wizard", "princess", "mega-knight", "royal-giant",
  "valkyrie", "pekka", "digger", "prince", "hog-rider",
];
const CREWS = ["tower-princess", "tower-king", "cannoneer", "duchess"];
/** Golden Age: the Giant is a war elephant (a creature), not a humanoid. */
const NOT_HUMANOID: Record<Edition, string[]> = { classic: [], golden: ["giant"] };

describe("cast coverage", () => {
  it("every humanoid card and crew has a variant in both editions", () => {
    for (const [ed, roster] of EDITIONS) {
      for (const id of [...HUMANOIDS, ...(ed === "classic" ? ["giant"] : []), ...CREWS]) {
        expect(roster[id], `${ed}:${id}`).toBeDefined();
      }
      for (const id of NOT_HUMANOID[ed]) expect(roster[id], `${ed}:${id} is a creature`).toBeUndefined();
    }
  });

  it("names at least two back-visible silhouette features per variant", () => {
    for (const [ed, roster] of EDITIONS) {
      for (const [id, v] of Object.entries(roster)) expect(v.back.length, `${ed}:${id}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("covers every Studio headgear and weapon; a flying champion falls back to the procedural rig", () => {
    const heads = ["none", "helmet", "hood", "crown", "horns", "turban"] as const;
    const weapons = ["sword", "axe", "hammer", "spear", "bow", "staff", "none"] as const;
    for (const ed of ["classic", "golden"] as const) {
      for (const headgear of heads) {
        for (const weapon of weapons) {
          const v = championVariant({ ...DEFAULT_CHAMPION, look: { ...DEFAULT_CHAMPION.look, headgear, weapon } }, ed);
          expect(v, `${ed} ${headgear} ${weapon}`).not.toBeNull();
          expect(teamRuleViolations(`champion ${headgear} ${weapon}`, v!)).toEqual([]);
        }
      }
      expect(championVariant({ ...DEFAULT_CHAMPION, abilities: { ...DEFAULT_CHAMPION.abilities, flying: true } }, ed)).toBeNull();
    }
  });

  it("puts the hair-under-hat fix on a real hair swatch", () => {
    for (const [, roster] of EDITIONS) for (const v of Object.values(roster)) if (v.hairBack) expect(HAIR_SWATCH[v.file]).toBeDefined();
  });

  it("keeps the art bible's heights: the giant towers, swarms stay small", () => {
    expect(CLASSIC.giant.scale).toBeGreaterThan(CLASSIC.knight.scale * 1.3);
    expect(CLASSIC.skeletons.scale).toBeLessThan(CLASSIC.knight.scale);
    expect(GOLDEN.skeletons.scale).toBeLessThan(GOLDEN.knight.scale);
  });
});

describe("cast lean", () => {
  const up = new THREE.Vector3();
  const front = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const yawQ = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);

  /** The body's world up and facing after root yaw, then the lean in the root's frame. */
  function lean(camX: number, camZ: number, yaw: number): void {
    leanQuaternion(camX, camZ, yaw, q);
    yawQ.setFromAxisAngle(Y, yaw);
    up.set(0, 1, 0).applyQuaternion(q).applyQuaternion(yawQ);
    front.set(0, 0, 1).applyQuaternion(q).applyQuaternion(yawQ);
  }

  it("is 14 degrees", () => {
    expect(LEAN_DEG).toBe(14);
    expect(LEAN).toBeCloseTo((14 * Math.PI) / 180);
    leanQuaternion(0, -1, 0.7, q);
    expect(2 * Math.acos(Math.min(1, Math.abs(q.w)))).toBeCloseTo(LEAN, 5);
  });

  it("tips the head away from the home camera whichever way the unit faces", () => {
    // Home camera at +z looking toward -z.
    for (const yaw of [0, Math.PI / 2, Math.PI, -0.6]) {
      lean(0, -1, yaw);
      expect(up.z).toBeCloseTo(-Math.sin(LEAN), 5);
      expect(up.x).toBeCloseTo(0, 5);
    }
  });

  it("tips away from the guest camera too (the online guest looks from -z)", () => {
    for (const yaw of [0, Math.PI]) {
      lean(0, 1, yaw);
      expect(up.z).toBeCloseTo(Math.sin(LEAN), 5);
    }
  });

  it("turns more of the body toward the camera (less hat-top) for a diagonal home-diorama camera", () => {
    const view = new THREE.Vector3(0.6, -0.8, -0.5).normalize();
    for (const yaw of [Math.PI, 0]) {
      lean(view.x, view.z, yaw);
      // The surface facing the camera (the back for yaw PI, the front for 0) faces it more squarely.
      const facing = front.clone().multiplyScalar(yaw === 0 ? 1 : -1);
      const before = new THREE.Vector3(0, 0, yaw === 0 ? 1 : -1).applyAxisAngle(Y, yaw).dot(view.clone().negate());
      expect(facing.dot(view.clone().negate())).toBeGreaterThan(before - 1e-9);
      // ...and the head top less so.
      expect(up.dot(view.clone().negate())).toBeLessThan(Y.dot(view.clone().negate()));
    }
  });
});

describe("cast animation", () => {
  it("steps the mixer at 60, 30 and 20 Hz down the quality ladder", () => {
    expect([0, 1, 2, 3, 4].map(mixerHz)).toEqual([60, 60, 30, 30, 20]);
  });
});

/** A synthetic source rig with the 23 deform bones in their real parent chain (no pack in node). */
function fakeSource(): Source {
  const parent: Record<string, string> = {
    hips: "root", spine: "hips", chest: "spine", head: "chest",
    upperarml: "chest", lowerarml: "upperarml", wristl: "lowerarml", handl: "wristl", handslotl: "handl",
    upperarmr: "chest", lowerarmr: "upperarmr", wristr: "lowerarmr", handr: "wristr", handslotr: "handr",
    upperlegl: "hips", lowerlegl: "upperlegl", footl: "lowerlegl", toesl: "footl",
    upperlegr: "hips", lowerlegr: "upperlegr", footr: "lowerlegr", toesr: "footr",
  };
  const bones = BONES.map((name) => Object.assign(new THREE.Bone(), { name }));
  for (const b of bones) if (parent[b.name]) bones[BONE_INDEX.get(parent[b.name])!].add(b);
  return { rig: bones[0], image: null as unknown as CanvasImageSource, bones, inverses: bones.map(() => new THREE.Matrix4()), remap: [] };
}

function fakeUnit(id: string, swarm: string) {
  for (const name of ["Idle", "Walking_A", "1H_Melee_Attack_Chop", "Hit_A", "Death_A"]) {
    if (!clips.has(name)) clips.set(name, new THREE.AnimationClip(name, 1, []));
  }
  const geometry = new THREE.BufferGeometry();
  const baked: Baked = { geometry, top: 2.3, halfWidth: 0.6, bodyCount: 0, vertices: 0, atlas: new THREE.Texture() };
  const u = makeUnit(id, CLASSIC.knight, baked, fakeSource(), "player", swarm);
  joinSwarm(u);
  return u;
}

describe("cast units", () => {
  it("is one skinned draw on its own 23-bone skeleton", () => {
    const u = fakeUnit("knight", "");
    const meshes: THREE.Mesh[] = [];
    u.group.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    expect(meshes).toHaveLength(1);
    expect((meshes[0] as THREE.SkinnedMesh).isSkinnedMesh).toBe(true);
    expect(u.skeleton.bones).toHaveLength(23);
    expect(u.caster).toBe(meshes[0]);
  });

  it("frees its skeleton's bone texture and its swarm slot when the view is disposed", () => {
    const u = fakeUnit("knight", "test:knight:player");
    u.skeleton.computeBoneTexture();
    const tex = u.skeleton.boneTexture!;
    let disposed = false;
    tex.addEventListener("dispose", () => (disposed = true));
    expect(swarmSize("test:knight:player")).toBe(1);
    const root = new THREE.Group();
    root.add(u.group);
    disposeDeep(root);
    expect(disposed).toBe(true);
    expect(u.skeleton.boneTexture).toBeNull();
    expect(swarmSize("test:knight:player")).toBe(0);
  });

  it("shares one pose per card and side once a swarm reaches six", () => {
    const units = Array.from({ length: SWARM_SHARE }, () => fakeUnit("skeletons", "test:skeletons:enemy"));
    expect(swarmLeader(units[0])).toBeNull();
    for (const u of units.slice(1)) expect(swarmLeader(u)).toBe(units[0]);
    const root = new THREE.Group();
    for (const u of units) root.add(u.group);
    disposeDeep(root);
    expect(swarmSize("test:skeletons:enemy")).toBe(0);
  });
});
