import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Side } from "../../game/arena";
import { createBattle, type BattleState } from "../../game/battle";
import {
  CALLOUT_FROM,
  CALLOUT_TO,
  DeployOverlay,
  REVEAL_DONE,
  REVEAL_LIFE,
  VIEW_SHIFT,
  laneMixAt,
  revealEnvelope,
  revealRadius,
} from "./deployOverlay";
import { CAM_HOME } from "./common";

const DT = 1 / 60;

/** Knock down `owner`'s princess tower in a lane (x < 9 is left). */
function fell(b: BattleState, owner: Side, lane: "left" | "right"): void {
  b.entities = b.entities.filter((e) => !(e.side === owner && e.kind === "princess-tower" && e.x < 9 === (lane === "left")));
}

/** Run the overlay's clocks for `seconds` (sync + render, like a frame). */
function run(o: DeployOverlay, b: BattleState, seconds: number, still = false, side: Side = "player"): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    o.sync(b, side, DT, still);
    o.render(0, 1, still);
  }
}

function uniforms(o: DeployOverlay): Record<string, THREE.IUniform> {
  return (o.mesh.material as THREE.ShaderMaterial).uniforms;
}

describe("reveal timeline", () => {
  it("grows the pocket from the ruin after a beat, then fades it out", () => {
    expect(revealRadius(0.3, false)).toBe(0);
    expect(revealRadius(0.7, false)).toBeCloseTo(0.42, 2);
    expect(revealRadius(1.6, false)).toBe(REVEAL_DONE);
    expect(revealEnvelope(0.3, true, false)).toBe(0);
    expect(revealEnvelope(2, true, false)).toBe(1);
    expect(revealEnvelope(4.3, true, false)).toBeCloseTo(0.5, 6);
    expect(revealEnvelope(4.6, true, false)).toBe(0);
  });

  it("starts a record when a lane opens on the same battle and drops it after 4.6 s", () => {
    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    run(o, b, 0.5);
    expect(o.parts.reveals).toEqual([]);
    fell(b, "enemy", "left");
    o.sync(b, "player", DT, false);
    expect(o.parts.reveals).toEqual([{ lane: "left", age: 0, wave: true }]); // t = 0 is the sync that sees it open
    expect(o.parts.pocketOnly).toBe(true);
    expect(o.parts.shown).toBe(false); // nothing new drawn yet: the collapse reads first
    run(o, b, 1.0);
    expect(o.parts.shown).toBe(true);
    expect(o.mesh.visible).toBe(true);
    run(o, b, REVEAL_LIFE - 1.0 - 4 * DT);
    expect(o.parts.reveals.length).toBe(1); // just before 4.6 s
    run(o, b, 6 * DT);
    expect(o.parts.reveals).toEqual([]);
    expect(o.parts.shown).toBe(false);
    o.render(0, 1, false);
    expect(o.mesh.visible).toBe(false);
  });
});

describe("no reveal", () => {
  it("on the first sync, a new battle object, a reset (context restore) or a finished match", () => {
    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    fell(b, "enemy", "left");
    o.sync(b, "player", DT, false); // first sync: seeds quietly
    expect(o.parts.reveals).toEqual([]);
    expect(o.parts.open.left).toBe(true);

    const b2 = createBattle();
    fell(b2, "enemy", "right");
    o.sync(b2, "player", DT, false); // a new state object
    expect(o.parts.reveals).toEqual([]);

    o.reset(); // the context-restore path: same state
    fell(b2, "enemy", "left");
    o.sync(b2, "player", DT, false);
    expect(o.parts.reveals).toEqual([]);

    const b3 = createBattle();
    o.sync(b3, "player", DT, false);
    fell(b3, "enemy", "left");
    o.sync(b3, "player", DT, false);
    expect(o.parts.reveals.length).toBe(1);
    b3.result = { winner: "player", playerCrowns: 3, enemyCrowns: 0 };
    o.sync(b3, "player", DT, false);
    expect(o.parts.reveals).toEqual([]);
    expect(o.parts.shown).toBe(false);
    o.hold("troop");
    expect(o.parts.shown).toBe(false); // the match is over: no map at all
  });

  it("for the viewer's own fallen tower", () => {
    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    o.sync(b, "player", DT, false);
    fell(b, "player", "left");
    o.sync(b, "player", DT, false);
    expect(o.parts.reveals).toEqual([]);
  });

  it("mirrors for the guest: the host's tower falling opens the guest's lane", () => {
    const o = new DeployOverlay({ golden: false });
    o.setView("enemy");
    const b = createBattle();
    o.sync(b, "enemy", DT, false);
    fell(b, "player", "right");
    o.sync(b, "enemy", DT, false);
    expect(o.parts.reveals.map((r) => r.lane)).toEqual(["right"]);
    run(o, b, 1.2, false, "enemy");
    expect(o.callout()).toMatchObject({ lane: "right", ax: 13.5, ay: 21 });
  });
});

describe("a lane opening under a held card", () => {
  it("cross-fades the lane, labels it, and counts as its welcome", () => {
    expect(laneMixAt(0.125)).toBeCloseTo(0.5, 6);
    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    run(o, b, 0.2);
    o.hold("troop");
    run(o, b, 0.2);
    fell(b, "enemy", "left");
    o.sync(b, "player", DT, false);
    expect(o.parts.reveals).toEqual([{ lane: "left", age: 0, wave: false }]);
    o.render(0, 1, false);
    expect((uniforms(o).uLaneMix.value as THREE.Vector2).x).toBeLessThan(0.2);
    expect((uniforms(o).uWaveL.value as THREE.Vector3).z).toBe(REVEAL_DONE); // no wave under a held card
    run(o, b, 0.3);
    expect((uniforms(o).uLaneMix.value as THREE.Vector2).x).toBe(1);
    expect(o.callout()).toBeNull();
    run(o, b, CALLOUT_FROM - 0.3);
    expect(o.callout()).not.toBeNull();
    // Welcomed already: a later pick-up does not pulse.
    o.hold(null);
    run(o, b, REVEAL_LIFE);
    o.hold("troop");
    run(o, b, 0.2);
    expect((uniforms(o).uWelcome.value as THREE.Vector2).x).toBe(0);
  });
});

describe("picking up and putting down mid-reveal", () => {
  it("finishes the wave, and shows the whole pocket again when the card goes down", () => {
    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    run(o, b, 0.2);
    fell(b, "enemy", "left");
    run(o, b, 0.9);
    o.render(0, 1, false);
    const r = (uniforms(o).uWaveL.value as THREE.Vector3).z;
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(REVEAL_DONE);
    o.hold("troop");
    expect(o.parts.reveals[0].wave).toBe(false);
    expect(o.parts.pocketOnly).toBe(false);
    run(o, b, 0.5);
    o.hold(null);
    expect(o.parts.pocketOnly).toBe(true);
    run(o, b, 0.2);
    o.render(0, 1, false);
    expect((uniforms(o).uEnv.value as THREE.Vector2).x).toBe(1);
    expect((uniforms(o).uWaveL.value as THREE.Vector3).z).toBe(REVEAL_DONE);
  });

  it("says hello once to a lane that opened while no card was held", () => {
    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    run(o, b, 0.2);
    fell(b, "enemy", "left");
    run(o, b, REVEAL_LIFE + 0.1);
    o.hold("troop");
    run(o, b, 0.3);
    expect((uniforms(o).uWelcome.value as THREE.Vector2).x).toBeGreaterThan(0.1);
    run(o, b, 0.5);
    expect((uniforms(o).uWelcome.value as THREE.Vector2).x).toBe(0);
    o.hold(null);
    o.hold("troop");
    run(o, b, 0.3);
    expect((uniforms(o).uWelcome.value as THREE.Vector2).x).toBe(0);
  });
});

describe("reduced motion", () => {
  it("fades the whole pocket in instead of growing it, and skips the welcome pulse", () => {
    expect(revealRadius(0.7, true)).toBe(REVEAL_DONE);
    expect(revealRadius(1.0, true)).toBe(REVEAL_DONE);
    expect(revealEnvelope(0.6, true, true)).toBe(0);
    expect(revealEnvelope(0.75, true, true)).toBeCloseTo(0.5, 6);
    expect(revealEnvelope(0.9, true, true)).toBe(1);

    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    run(o, b, 0.2, true);
    fell(b, "enemy", "left");
    run(o, b, 0.75, true);
    o.render(0, 1, true);
    expect((uniforms(o).uWaveL.value as THREE.Vector3).z).toBe(REVEAL_DONE);
    expect((uniforms(o).uEnv.value as THREE.Vector2).x).toBeGreaterThan(0.3);
    expect((uniforms(o).uEnv.value as THREE.Vector2).x).toBeLessThan(0.7);
    run(o, b, REVEAL_LIFE, true);
    o.hold("troop");
    run(o, b, 0.3, true);
    expect((uniforms(o).uWelcome.value as THREE.Vector2).x).toBe(0);
    // The refusal flash holds steady instead of beating.
    o.refuse("king", 8, 4);
    o.render(0, 1, true);
    expect(uniforms(o).uFlash.value).toBeCloseTo(0.22, 6);
    run(o, b, 0.3, true);
    expect(uniforms(o).uFlash.value).toBeCloseTo(0.22, 6);
  });
});

describe("the label callout", () => {
  it("shows the newest reveal from 1.0 s to 4.0 s, and hides when dismissed", () => {
    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    run(o, b, 0.2);
    fell(b, "enemy", "left");
    run(o, b, CALLOUT_FROM - 0.05);
    expect(o.callout()).toBeNull();
    run(o, b, 0.1);
    const c = o.callout()!;
    expect(c).toMatchObject({ lane: "left", ax: 4.5, ay: 11 });
    // The second tower falls: its label replaces the first.
    fell(b, "enemy", "right");
    run(o, b, CALLOUT_FROM + 0.05);
    const c2 = o.callout()!;
    expect(c2.lane).toBe("right");
    expect(c2.id).not.toBe(c.id);
    o.dismissCallout();
    expect(o.callout()).toBeNull();
    expect(o.parts.callout).toBe(false);
    // Past 4.0 s nothing, dismissed or not.
    const o2 = new DeployOverlay({ golden: false });
    const b2 = createBattle();
    run(o2, b2, 0.2);
    fell(b2, "enemy", "right");
    run(o2, b2, CALLOUT_TO + 0.05);
    expect(o2.callout()).toBeNull();
  });
});

describe("the plane", () => {
  it("slides along the camera ray: +0.13 for the host, -0.13 for the guest", () => {
    const o = new DeployOverlay({ golden: false });
    expect(VIEW_SHIFT).toBeCloseTo(0.13, 6);
    o.setView("player");
    expect(o.shift).toBeCloseTo(0.13, 6);
    o.setView("enemy");
    expect(o.shift).toBeCloseTo(-0.13, 6);
    expect(o.mesh.position.y).toBe(0.15);
    expect(o.mesh.renderOrder).toBe(-0.5);
    expect(o.mesh.name).toBe("deploy-overlay");
  });

  it("draws every line over the ground point it describes, in both views and any framing", () => {
    const vs = (o: DeployOverlay): string => (o.mesh.material as THREE.ShaderMaterial).vertexShader;
    const o = new DeployOverlay({ golden: false });
    expect(vs(o)).toMatch(/vTile\s*=\s*vec2\(position\.x/);
    for (const side of ["player", "enemy"] as Side[]) {
      o.setView(side);
      o.mesh.updateMatrixWorld(true);
      for (const [w, h] of [
        [10, 18],
        [7.3, 12.1],
        [20, 9],
      ]) {
        const cam = new THREE.OrthographicCamera(-w, w, h, -h, -50, 120);
        cam.position.set(CAM_HOME.x, CAM_HOME.y, side === "player" ? CAM_HOME.z : -CAM_HOME.z);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();
        for (const [ax, ay] of [
          [4.5, 15],
          [9, 7],
          [0, 0],
          [18, 32],
          [13.2, 21.7],
        ]) {
          const lifted = o.mesh.localToWorld(new THREE.Vector3(ax - 9, 0, ay - 16)).project(cam);
          const ground = new THREE.Vector3(ax - 9, 0, ay - 16).project(cam);
          expect(Math.abs(lifted.x - ground.x)).toBeLessThan(1e-6);
          expect(Math.abs(lifted.y - ground.y)).toBeLessThan(1e-6);
        }
      }
    }
  });

  it("costs one mesh of two triangles", () => {
    const o = new DeployOverlay({ golden: false });
    let meshes = 0;
    o.mesh.traverse((n) => {
      if ((n as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(1);
    expect(o.mesh.geometry.index!.count).toBe(6);
  });

  it("frees its texture, material and geometry", () => {
    const o = new DeployOverlay({ golden: false });
    const mat = o.mesh.material as THREE.ShaderMaterial;
    const tex = mat.uniforms.uField.value as THREE.DataTexture;
    const spies = [vi.spyOn(tex, "dispose"), vi.spyOn(mat, "dispose"), vi.spyOn(o.mesh.geometry, "dispose")];
    o.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });

  it("turns its stripes light on a dark floor", () => {
    const o = new DeployOverlay({ golden: false });
    o.setLook({ floor: { a: "#6ebb40" } } as never);
    expect(o.lightStripes).toBe(false);
    o.setLook({ floor: { a: "#2a2630" } } as never);
    expect(o.lightStripes).toBe(true);
  });

  it("samples what it draws: the open pocket is allowed, the King's keep-clear is not", () => {
    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    fell(b, "enemy", "left");
    o.hold("troop");
    o.sync(b, "player", DT, false);
    expect(o.sample(4, 10)).toBeGreaterThan(0);
    expect(o.sample(8, 4)).toBeLessThan(0);
    expect(o.sample(13, 10)).toBeLessThan(0);
    expect(o.sample(9, 24)).toBeGreaterThan(0);
    expect(o.parts).toMatchObject({ shown: true, mode: "troop", pocketOnly: false, open: { left: true, right: false } });
  });
});
