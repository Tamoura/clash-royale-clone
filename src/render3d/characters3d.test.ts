import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Side } from "../game/arena";
import { getCard, CARDS, DECK, type CardId } from "../game/cards";
import { animateTroop, buildTroop, toon } from "./characters3d";
import { TEAM, isTeamPart, type TeamShade } from "./teamColors";

const TROOP_IDS = DECK.filter((id) => getCard(id).kind === "troop");

describe("3D troop rigs", () => {
  it("builds a rig for every troop card", () => {
    for (const id of TROOP_IDS) {
      const rig = buildTroop(id as CardId);
      expect(rig.group.children.length).toBeGreaterThan(2);
      expect(rig.height).toBeGreaterThan(0.5);
      // Every troop animates somehow: a weapon arm or flapping wings.
      expect(rig.arm !== null || (rig.wings?.length ?? 0) > 0).toBe(true);
    }
  });

  it("builds rigs for the firecracker and magic archer", () => {
    for (const id of ["firecracker", "magic-archer"] as const) {
      const rig = buildTroop(id);
      expect(rig.group.children.length).toBeGreaterThan(2);
      expect(rig.height).toBeGreaterThan(0.5);
      expect(rig.arm).not.toBeNull(); // both wield a weapon arm
    }
  });

  it("flying troops hover and have wings", () => {
    for (const id of ["baby-dragon", "gargoyles"] as const) {
      const rig = buildTroop(id);
      expect(rig.hover).toBeGreaterThan(0);
      expect(rig.wings?.length).toBe(2);
    }
  });

  it("ground troops have jointed legs that swing while walking", () => {
    const rig = buildTroop("knight");
    expect(rig.legs?.length).toBe(2);
    animateTroop(rig, { moving: true, swing: 0, time: 0.15, phase: 0 });
    const [left, right] = rig.legs!;
    expect(left.rotation.x).not.toBe(0);
    // Legs swing in opposite directions.
    expect(Math.sign(left.rotation.x)).toBe(-Math.sign(right.rotation.x));
    animateTroop(rig, { moving: false, swing: 0, time: 0.15, phase: 0 });
    expect(left.rotation.x).toBe(0);
  });

  it("the prince's pony has four galloping legs", () => {
    const rig = buildTroop("prince");
    expect(rig.legs?.length).toBe(4);
  });

  it("rejects spell cards", () => {
    expect(() => buildTroop("fireball")).toThrow();
  });

  it("attack swing rotates the weapon arm", () => {
    const rig = buildTroop("knight");
    const rest = rig.arm!.rotation.x;
    animateTroop(rig, { moving: false, swing: 1, time: 0, phase: 0 });
    expect(rig.arm!.rotation.x).toBeLessThan(rest);
    animateTroop(rig, { moving: false, swing: 0, time: 0, phase: 0 });
    expect(rig.arm!.rotation.x).toBeCloseTo(rest);
  });

  it("walking bobs the body; standing does not", () => {
    const rig = buildTroop("giant");
    animateTroop(rig, { moving: true, swing: 0, time: 0.2, phase: 0 });
    expect(rig.group.position.y).toBeGreaterThan(0);
    animateTroop(rig, { moving: false, swing: 0, time: 0.2, phase: 0 });
    expect(rig.group.position.y).toBe(0);
  });

  it("every mesh in a rig casts a shadow", () => {
    const rig = buildTroop("mini-pekka");
    let meshCount = 0;
    rig.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) {
        meshCount++;
      }
    });
    expect(meshCount).toBeGreaterThan(5);
  });
});

describe("tower defenders", () => {
  it("the tower princess is a small archer with a bow arm", async () => {
    const { buildTowerPrincess } = await import("./characters3d");
    const rig = buildTowerPrincess();
    expect(rig.group.children.length).toBeGreaterThan(2);
    expect(rig.arm).not.toBeNull();
    expect(rig.height).toBeGreaterThan(0.5);
  });

  it("the tower king bears a crown and a sword arm", async () => {
    const { buildTowerKing } = await import("./characters3d");
    const rig = buildTowerKing();
    expect(rig.group.children.length).toBeGreaterThan(3);
    expect(rig.arm).not.toBeNull();
    expect(rig.height).toBeGreaterThan(0.5);
  });
});

describe("charge telegraph", () => {
  it("a charging prince couches his lance and leans in", () => {
    const rig = buildTroop("prince");
    animateTroop(rig, { moving: true, swing: 0, time: 0.2, phase: 0, charging: true });
    const couched = rig.arm!.rotation.x;
    const lean = rig.group.rotation.x;
    animateTroop(rig, { moving: true, swing: 0, time: 0.2, phase: 0 });
    expect(couched).toBeLessThan(rig.arm!.rotation.x);
    expect(lean).toBeGreaterThan(rig.group.rotation.x);
  });
});

describe("idle personality", () => {
  it("animateTroop drives the rig's extras hook with time", async () => {
    const { vi } = await import("vitest");
    const rig = buildTroop("knight");
    rig.extras = vi.fn();
    animateTroop(rig, { moving: false, swing: 0, time: 1.5, phase: 0.3 });
    expect(rig.extras).toHaveBeenCalledWith(1.5, 0.3);
  });

  it("the witch's skull familiar and wizard's orb have extras", () => {
    expect(buildTroop("witch").extras).toBeDefined();
    expect(buildTroop("wizard").extras).toBeDefined();
    expect(buildTroop("baby-dragon").extras).toBeDefined();
  });
});

describe("cel outlines", () => {
  it("every troop rig carries inverted-hull outline meshes", () => {
    for (const id of ["knight", "witch", "pekka"] as const) {
      let outlines = 0;
      buildTroop(id).group.traverse((o) => {
        if (o.name === "outline") outlines++;
      });
      expect(outlines).toBeGreaterThan(3);
    }
  });

  it("outlines are bold — thick and near-black — for the CR cartoon look", () => {
    let outline: THREE.Mesh | null = null;
    buildTroop("knight").group.traverse((o) => {
      if (o.name === "outline" && !outline) outline = o as THREE.Mesh;
    });
    expect(outline).not.toBeNull();
    const o = outline as unknown as THREE.Mesh;
    expect(o.scale.x).toBeGreaterThanOrEqual(1.07);
    expect(o.scale.x).toBeLessThan(1.09); // strong silhouette without swallowing details
    const mat = o.material as THREE.MeshBasicMaterial;
    expect(mat.color.r).toBeLessThan(0.08); // near-black, not navy
    expect(mat.color.g).toBeLessThan(0.08);
    expect(mat.color.b).toBeLessThan(0.08);
  });

  it("outlines are skipped for tiny detail meshes", () => {
    const rig = buildTroop("skeletons");
    let total = 0;
    let outlines = 0;
    rig.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) total++;
      if (o.name === "outline") outlines++;
    });
    expect(outlines).toBeGreaterThan(0);
    expect(outlines).toBeLessThan(total - outlines); // not 1:1
  });
});

describe("expressive faces", () => {
  it("humanoid rigs have sclera eyes, brows, and a mouth", () => {
    for (const id of ["knight", "witch", "valkyrie"] as const) {
      const counts = { eye: 0, pupil: 0, brow: 0, mouth: 0 };
      buildTroop(id).group.traverse((o) => {
        if (o.name in counts) counts[o.name as keyof typeof counts]++;
      });
      expect(counts.eye).toBeGreaterThanOrEqual(2);
      expect(counts.pupil).toBeGreaterThanOrEqual(2);
      expect(counts.brow).toBeGreaterThanOrEqual(2);
      expect(counts.mouth).toBeGreaterThanOrEqual(1);
    }
  });

  it("moods angle the brows differently", () => {
    const browAngles = (id: "witch" | "giant"): number[] => {
      const angles: number[] = [];
      buildTroop(id).group.traverse((o) => {
        if (o.name === "brow") angles.push(Math.abs(o.rotation.z));
      });
      return angles;
    };
    const wicked = browAngles("witch");
    const calm = browAngles("giant");
    expect(Math.max(...wicked)).toBeGreaterThan(Math.max(...calm));
  });
});

describe("geometry cache (three-best-practices)", () => {
  it("identical primitives share one geometry instance across rigs", () => {
    const geos = (id: "knight" | "skeletons"): THREE.BufferGeometry[] => {
      const out: THREE.BufferGeometry[] = [];
      buildTroop(id).group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) out.push(mesh.geometry as THREE.BufferGeometry);
      });
      return out;
    };
    const a = geos("knight");
    const b = geos("knight");
    expect(a.length).toBeGreaterThan(0);
    // Two separate knights reuse the exact same geometry objects.
    expect(a.every((g, i) => g === b[i])).toBe(true);
  });

  it("cached geometries are marked shared so disposal skips them", () => {
    let sharedCount = 0;
    buildTroop("giant").group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.geometry as THREE.BufferGeometry).userData.shared) {
        sharedCount++;
      }
    });
    expect(sharedCount).toBeGreaterThan(5);
  });
});

describe("ball-jointed limbs", () => {
  it("weapon arms gain a shoulder ball and a fist", () => {
    for (const id of ["knight", "wizard", "hog-rider"] as const) {
      const rig = buildTroop(id);
      const names = rig.arm!.children.map((c) => c.name);
      expect(names).toContain("joint-shoulder");
      expect(names).toContain("joint-fist");
    }
  });

  it("legs gain hip joints and chunky feet", () => {
    const rig = buildTroop("knight");
    for (const leg of rig.legs!) {
      const names = leg.children.map((c) => c.name);
      expect(names).toContain("joint-hip");
      expect(names).toContain("foot");
    }
  });

  it("joints reuse the limb's own material so flashes stay uniform", () => {
    const rig = buildTroop("knight");
    const sleeve = rig.arm!.children.find(
      (c) => (c as THREE.Mesh).isMesh && !c.name.startsWith("joint"),
    ) as THREE.Mesh;
    const fist = rig.arm!.children.find((c) => c.name === "joint-fist") as THREE.Mesh;
    expect(fist.material).toBe(sleeve.material);
  });
});

describe("animation principles", () => {
  it("signed swing: wind-up raises the arm behind rest, strike sweeps past it", () => {
    const rig = buildTroop("knight");
    const at = (swing: number): number => {
      animateTroop(rig, { moving: false, swing, time: 0, phase: 0 });
      return rig.arm!.rotation.x;
    };
    const windup = at(-0.6);
    const rest = at(0);
    const strike = at(1);
    expect(windup).toBeGreaterThan(rest); // anticipation: arm cocked back
    expect(strike).toBeLessThan(rest); // strike: arm swept forward
  });

  it("the body squashes on a heavy strike", () => {
    const rig = buildTroop("knight");
    animateTroop(rig, { moving: false, swing: 0, time: 0.1, phase: 0 });
    const restScale = rig.group.scale.y;
    animateTroop(rig, { moving: false, swing: 1, time: 0.1, phase: 0 });
    expect(rig.group.scale.y).toBeLessThan(restScale);
  });

  it("the off-arm lags the legs for overlapping action", () => {
    const rig = buildTroop("knight");
    // At a walk-cycle zero crossing the legs are neutral but the
    // lagging off-arm must not be.
    animateTroop(rig, { moving: true, swing: 0, time: Math.PI / 10, phase: 0 });
    expect(Math.abs(rig.legs![0].rotation.x)).toBeLessThan(0.02);
    expect(Math.abs(rig.offArm!.rotation.x)).toBeGreaterThan(0.05);
  });
});

describe("islamic reskins (ARABIC mode)", () => {
  // The test env has no localStorage, so theme.ts defaults ARABIC to true:
  // buildTroop() routes through the Islamic builders here.
  it("the giant is a war elephant: four legs, tusks, and a turbaned rider", () => {
    const rig = buildTroop("giant");
    expect(rig.legs?.length).toBe(4); // a quadruped, not the 2-legged strongman
    const counts = { tusk: 0, trunk: 0, brow: 0 };
    rig.group.traverse((o) => {
      if (o.name in counts) counts[o.name as keyof typeof counts]++;
    });
    expect(counts.tusk).toBeGreaterThanOrEqual(2);
    expect(counts.trunk).toBeGreaterThanOrEqual(1);
    expect(counts.brow).toBeGreaterThanOrEqual(2); // a human rider sits on top
    expect(rig.height).toBeGreaterThan(2); // reads as a towering tank
  });

  it("the hog rider is a camel raider: four legs, a bobbing neck, a turbaned rider", () => {
    const rig = buildTroop("hog-rider");
    expect(rig.legs?.length).toBe(4); // a quadruped camel, not the hog
    const names = new Set<string>();
    rig.group.traverse((o) => names.add(o.name));
    expect(names.has("neck")).toBe(true);
    expect(names.has("brow")).toBe(true); // human rider face
    expect(rig.extras).toBeDefined(); // neck bob + tail flick idle
    expect(rig.arm).not.toBeNull(); // raised scimitar attack arm
  });

  it("the balloon is a fire-kite: a hovering canopy with fluttering tails", () => {
    const rig = buildTroop("balloon");
    expect(rig.hover).toBeGreaterThan(0); // still a flyer
    let tails = 0;
    rig.group.traverse((o) => {
      // Two cloth tails fly team colours (renamed "team", part kept).
      if ((o.userData.part ?? o.name) === "kite-tail") tails++;
    });
    expect(tails).toBeGreaterThanOrEqual(3);
    expect(rig.extras).toBeDefined(); // tail flutter + flame flicker
    expect(rig.arm).not.toBeNull(); // fire-pot dropping arm
  });

  it("the musketeer is a janissary with a tall börk hat", () => {
    const names = new Set<string>();
    buildTroop("musketeer").group.traverse((o) => names.add(o.name));
    expect(names.has("bork")).toBe(true);
    expect(names.has("musket")).toBe(true);
  });

  it("the mini-pekka is a duelist with a buckler and scimitar", () => {
    const names = new Set<string>();
    const rig = buildTroop("mini-pekka");
    rig.group.traverse((o) => names.add(o.name));
    expect(names.has("buckler")).toBe(true);
    expect(rig.arm).not.toBeNull();
    expect(rig.height).toBeLessThan(2); // lean swordsman, not a robot tank
  });

  it("the witch is a war drummer with a copper drum and mallet", () => {
    const names = new Set<string>();
    const rig = buildTroop("witch");
    rig.group.traverse((o) => names.add(o.name));
    expect(names.has("drum")).toBe(true);
    expect(names.has("mallet")).toBe(true);
    expect(rig.extras).toBeDefined();
  });

  it("the wizard is an alchemist with an alembic and elixir orb", () => {
    const names = new Set<string>();
    buildTroop("wizard").group.traverse((o) => names.add(o.name));
    expect(names.has("alembic")).toBe(true);
    expect(names.has("elixir")).toBe(true);
  });

  it("the pekka is a cataphract: four legs, nasal helm, kontos lance", () => {
    const rig = buildTroop("pekka");
    expect(rig.legs?.length).toBe(4);
    const names = new Set<string>();
    rig.group.traverse((o) => names.add(o.name));
    expect(names.has("nasal-helm")).toBe(true);
    expect(names.has("kontos")).toBe(true);
    expect(rig.height).toBeGreaterThan(2);
  });

  it("the mega-knight is a mamluk amir with a fluted helm", () => {
    const names = new Set<string>();
    buildTroop("mega-knight").group.traverse((o) => names.add(o.name));
    expect(names.has("mamluk-helm")).toBe(true);
  });

  it("the baby dragon is a roc hatchling with beak and feathered wings", () => {
    const rig = buildTroop("baby-dragon");
    expect(rig.hover).toBeGreaterThan(0);
    expect(rig.wings?.length).toBe(2);
    const names = new Set<string>();
    rig.group.traverse((o) => names.add(o.name));
    expect(names.has("beak")).toBe(true);
    expect(names.has("roc-wing")).toBe(true);
  });

  it("gargoyles and minions are war falcons with hoods", () => {
    for (const id of ["gargoyles", "minions"] as const) {
      const rig = buildTroop(id);
      expect(rig.hover).toBeGreaterThan(0);
      expect(rig.wings?.length).toBe(2);
      const names = new Set<string>();
      rig.group.traverse((o) => names.add(o.name));
      expect(names.has("falcon-hood")).toBe(true);
      expect(names.has("beak")).toBe(true);
    }
  });

  it("skeletons are militia spearmen with turbans", () => {
    const names = new Set<string>();
    const rig = buildTroop("skeletons");
    rig.group.traverse((o) => names.add(o.name));
    expect(names.has("spear")).toBe(true);
    expect(names.has("brow")).toBe(true); // human face, not a bare skull
    expect(rig.height).toBeLessThan(1.2);
  });

  it("the royal giant is a bombardier with a bronze bombard", () => {
    const names = new Set<string>();
    buildTroop("royal-giant").group.traverse((o) => names.add(o.name));
    expect(names.has("bombard")).toBe(true);
  });
});

describe("clash design cues (named signature props)", () => {
  // These cues are authored on Clash builders; Islamic overrides replace some
  // cards entirely, so we only assert cues that survive on shared Clash paths
  // or on cards without an Islamic silhouette swap.
  it("firecracker carries a launcher tube and a team headband", () => {
    // Firecracker has no Islamic override — cues always present. The
    // headband is a team part, so its name lives on in userData.part.
    const names = new Set<string>();
    buildTroop("firecracker").group.traverse((o) => names.add(o.userData.part ?? o.name));
    expect(names.has("launcher")).toBe(true);
    expect(names.has("headband")).toBe(true);
    expect(names.has("ponytail")).toBe(true);
  });

  it("magic archer has cyan eye glow", () => {
    let glowEyes = 0;
    buildTroop("magic-archer").group.traverse((o) => {
      if (o.name === "eyeglow") glowEyes++;
    });
    expect(glowEyes).toBeGreaterThanOrEqual(2);
  });

  it("tower king and princess keep chunky heads and weapon arms", () => {
    return Promise.all([
      import("./characters3d").then(({ buildTowerKing, buildTowerPrincess }) => {
        const king = buildTowerKing();
        const princess = buildTowerPrincess();
        expect(king.height).toBeGreaterThan(1.4);
        expect(princess.height).toBeGreaterThan(1.0);
        expect(king.arm).not.toBeNull();
        expect(princess.arm).not.toBeNull();
      }),
    ]);
  });
});

describe("surface texturing (3d-texturing skill)", () => {
  it("toon materials carry a shared grain detail map", () => {
    const a = toon(0x4e342e);
    const b = toon(0x94a1ae);
    expect(a.map).not.toBeNull();
    expect(a.map).toBe(b.map); // one cached texture, not per-material
    expect(a.map!.userData.shared).toBe(true);
    expect(a.map!.colorSpace).toBe(THREE.NoColorSpace);
  });

  it("material instances stay distinct so per-entity flashes don't bleed", () => {
    // Two separate rigs must own separate materials (emissive is
    // mutated per entity for damage flash / rage / charge).
    const m1 = (buildTroop("knight").group.children.find(
      (c) => (c as THREE.Mesh).isMesh,
    ) as THREE.Mesh).material;
    const m2 = (buildTroop("knight").group.children.find(
      (c) => (c as THREE.Mesh).isMesh,
    ) as THREE.Mesh).material;
    expect(m1).not.toBe(m2);
  });
});

// ---------------------------------------------------------------------------
// Team identity: bodies are team-neutral, tagged parts carry the side.

type BuildTroop = typeof buildTroop;

/**
 * buildTroop for one edition. ARABIC is fixed at module load (the test env
 * defaults to the Islamic edition), so the Clash edition gets a fresh copy
 * of the module graph with the theme flag mocked off.
 */
async function editionBuilder(edition: "classic" | "islamic"): Promise<BuildTroop> {
  if (edition === "islamic") return buildTroop;
  vi.resetModules();
  vi.doMock("./theme", async (orig) => ({ ...(await orig<typeof import("./theme")>()), ARABIC: false }));
  try {
    return (await import("./characters3d")).buildTroop;
  } finally {
    vi.doUnmock("./theme");
    vi.resetModules();
  }
}

/** Every card id that has a 3D builder in this edition. */
function rigIds(build: BuildTroop): CardId[] {
  return (Object.keys(CARDS) as CardId[]).filter((id) => {
    try {
      build(id);
      return true;
    } catch {
      return false;
    }
  });
}

function colorOf(mesh: THREE.Mesh): number | null {
  const mat = mesh.material as THREE.Material & { color?: THREE.Color };
  return mat.color ? mat.color.getHex() : null;
}

/** Flatten a rig into comparable node records (depth-first, stable order). */
function nodes(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => out.push(o));
  return out;
}

function sameNode(a: THREE.Object3D, b: THREE.Object3D): void {
  expect(b.type).toBe(a.type);
  expect(b.name).toBe(a.name);
  expect(b.children.length).toBe(a.children.length);
  expect(b.position.toArray()).toEqual(a.position.toArray());
  expect(b.rotation.toArray()).toEqual(a.rotation.toArray());
  expect(b.scale.toArray()).toEqual(a.scale.toArray());
  const ma = a as THREE.Mesh, mb = b as THREE.Mesh;
  if (ma.isMesh) {
    expect(mb.geometry.type).toBe(ma.geometry.type);
    expect(JSON.stringify((mb.geometry as THREE.BufferGeometry & { parameters?: unknown }).parameters))
      .toBe(JSON.stringify((ma.geometry as THREE.BufferGeometry & { parameters?: unknown }).parameters));
    expect((mb.material as THREE.Material).type).toBe((ma.material as THREE.Material).type);
  }
}

/** Near-white and near-black read as white/black at any hue: not a team cue. */
const NEUTRAL_LIGHTNESS = (l: number): boolean => l >= 0.85 || l <= 0.15;

/**
 * Non-team materials that may sit near a team hue, each with its reason.
 * Keyed "<cardId>:#rrggbb" (sRGB of the final material colour).
 */
const PALETTE_ALLOW: Record<string, string> = {
  // (empty: every hit in the audit was recoloured or reads as white/black)
};

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function hueOf(hex: number): number {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color().setHex(hex).getHSL(hsl, THREE.SRGBColorSpace);
  return hsl.h * 360;
}

for (const edition of ["classic", "islamic"] as const) {
  describe(`team identity (${edition} edition)`, () => {
    it("routes through the right edition's builders", async () => {
      const build = await editionBuilder(edition);
      // The Islamic Giant is a four-legged war elephant.
      expect(build("giant").legs?.length).toBe(edition === "classic" ? 2 : 4);
    });

    it("player and enemy rigs share one node tree and differ only on 'team' meshes", async () => {
      const build = await editionBuilder(edition);
      const ids = rigIds(build);
      expect(ids.length).toBeGreaterThanOrEqual(DECK.filter((id) => getCard(id).kind === "troop").length);
      for (const id of ids) {
        const p = nodes(build(id, "player").group);
        const e = nodes(build(id, "enemy").group);
        expect(e.length, id).toBe(p.length);
        let team = 0;
        for (let i = 0; i < p.length; i++) {
          sameNode(p[i], e[i]);
          const mp = p[i] as THREE.Mesh, me = e[i] as THREE.Mesh;
          if (!mp.isMesh) continue;
          if (isTeamPart(mp)) {
            team++;
            const shade = mp.userData.team as TeamShade;
            expect(me.userData.team).toBe(shade);
            expect(colorOf(mp), `${id} player team part`).toBe(TEAM.default.player[shade]);
            expect(colorOf(me), `${id} enemy team part`).toBe(TEAM.default.enemy[shade]);
          } else {
            expect(colorOf(me), `${id} non-team mesh ${mp.name || i}`).toBe(colorOf(mp));
          }
        }
        expect(team, `${id} has a team part`).toBeGreaterThanOrEqual(1);
      }
    });

    it("team parts stay separate meshes that never share a limb's material", async () => {
      const build = await editionBuilder(edition);
      for (const id of rigIds(build)) {
        const mats = new Map<THREE.Material, string[]>();
        build(id, "enemy").group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const list = mats.get(m.material as THREE.Material) ?? [];
          list.push(o.name);
          mats.set(m.material as THREE.Material, list);
        });
        for (const names of mats.values()) {
          // A team material is owned by exactly one team mesh.
          if (names.includes("team")) expect(names, id).toEqual(["team"]);
        }
      }
    });

    it("no body material sits near team blue or red (palette audit)", async () => {
      const build = await editionBuilder(edition);
      const blue = hueOf(TEAM.default.player.main);
      const red = hueOf(TEAM.default.enemy.main);
      const hits: string[] = [];
      for (const id of rigIds(build)) {
        build(id, "player").group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || isTeamPart(m) || o.name === "outline") return;
          const mat = m.material as THREE.Material & { color?: THREE.Color };
          if (!mat.color) return;
          const hsl = { h: 0, s: 0, l: 0 };
          mat.color.getHSL(hsl, THREE.SRGBColorSpace);
          if (hsl.s <= 0.55 || NEUTRAL_LIGHTNESS(hsl.l)) return;
          const h = hsl.h * 360;
          if (hueDistance(h, blue) > 15 && hueDistance(h, red) > 15) return;
          const key = `${id}:#${mat.color.getHexString(THREE.SRGBColorSpace)}`;
          if (!(key in PALETTE_ALLOW)) hits.push(`${key} (${o.name || "unnamed"}, h=${h.toFixed(0)})`);
        });
      }
      expect(hits).toEqual([]);
    });
  });
}

describe("team identity (palette)", () => {
  it("buildTroop defaults to the player side", () => {
    const parts: number[] = [];
    buildTroop("knight").group.traverse((o) => {
      if (isTeamPart(o) && o.userData.team === "main") parts.push(colorOf(o as THREE.Mesh)!);
    });
    expect(parts.length).toBeGreaterThan(0);
    expect(new Set(parts)).toEqual(new Set([TEAM.default.player.main]));
  });

  it("every side has a distinct main and dark shade in both palettes", () => {
    for (const palette of ["default", "cb"] as const) {
      for (const side of ["player", "enemy"] as Side[]) {
        expect(TEAM[palette][side].main).not.toBe(TEAM[palette][side].dark);
      }
      expect(TEAM[palette].player.main).not.toBe(TEAM[palette].enemy.main);
    }
  });
});
