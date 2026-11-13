import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BRIDGE_HALF_WIDTH,
  BRIDGE_XS,
  RIVER_HALF_WIDTH,
  RIVER_Y,
  type Side,
} from "../../game/arena";
import { checkDeploy, createBattle, deployCard, type BattleState } from "../../game/battle";
import type { CardId } from "../../game/cards";
import {
  CALLOUT_FROM,
  CALLOUT_TO,
  DIG_THICK,
  DeployOverlay,
  FILL_CLASSIC,
  FILL_GOLDEN,
  NIGHT_EDGE_ALPHA,
  NIGHT_FILL_CUT,
  NIGHT_FILL_CUT_GOLDEN,
  REVEAL_DONE,
  REVEAL_LIFE,
  REVEAL_RADIUS,
  VIEW_SHIFT,
  floorSwatch,
  glslFloat,
  laneMixAt,
  revealEnvelope,
  revealRadius,
  srgbLuma,
} from "./deployOverlay";
import { CAM_HOME } from "./common";
import { KING_KEEP_CLEAR, ruinSpot } from "../deployZone";
import { ISLAMIC_LOOKS, LOOKS } from "../arenaLooks";

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
    expect(revealRadius(0.7, false)).toBeCloseTo(REVEAL_RADIUS * 0.028, 6); // smoothstep(0.1)
    expect(revealRadius(1.6, false)).toBe(REVEAL_DONE);
    expect(revealEnvelope(0.3, true, false)).toBe(0);
    expect(revealEnvelope(2, true, false)).toBe(1);
    expect(revealEnvelope(4.3, true, false)).toBeCloseTo(0.5, 6);
    expect(revealEnvelope(4.6, true, false)).toBe(0);
  });

  it("sweeps the front across the whole pocket for the whole grow, ending just past its farthest corner", () => {
    for (const side of ["player", "enemy"] as Side[]) {
      for (const lane of ["left", "right"] as const) {
        const ruin = ruinSpot(side, lane);
        // The pocket: the lane's dry enemy half (x 0..9 or 9..18, y 0..15 or 17..32).
        const xs = lane === "left" ? [0, 9] : [9, 18];
        const ys = side === "player" ? [0, 15] : [17, 32];
        let far = 0;
        for (const x of xs) for (const y of ys) far = Math.max(far, Math.hypot(x - ruin.x, y - ruin.y));
        expect(far).toBeCloseTo(10.12, 2);
        expect(REVEAL_RADIUS).toBeGreaterThan(far + 0.2); // the rim clears the corner at the end
        expect(revealRadius(1.4, false)).toBeLessThan(far); // still sweeping at 80% of the grow
      }
    }
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

describe("a lane opening under a held Digger", () => {
  it("does not stripe the lane: the dig map did not change, so there is nothing to cross-fade", () => {
    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    run(o, b, 0.2);
    o.hold("dig");
    run(o, b, 0.2);
    fell(b, "enemy", "left");
    o.sync(b, "player", DT, false);
    o.render(0, 1, false);
    expect(uniforms(o).uDig.value).toBe(1);
    expect((uniforms(o).uLaneMix.value as THREE.Vector2).x).toBe(1); // no closed look over Digger ground
    expect(o.sample(4, 10)).toBeGreaterThan(0); // the Digger may go there, before and after
    expect(o.parts.reveals).toEqual([{ lane: "left", age: 0, wave: false }]);
    // The troop map never showed that lane opening: the first troop pick-up after it still says hello.
    o.hold(null);
    run(o, b, REVEAL_LIFE + 0.1);
    o.hold("troop");
    run(o, b, 0.3);
    expect((uniforms(o).uWelcome.value as THREE.Vector2).x).toBeGreaterThan(0.1);
  });
});

describe("leaving the battle for a menu", () => {
  it("drops the reveal, the label and a held map at once, though the menus sync with dt 0", () => {
    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    run(o, b, 0.2);
    fell(b, "enemy", "left");
    run(o, b, 2.5);
    expect(o.parts).toMatchObject({ shown: true, pocketOnly: true, callout: true });
    o.hold("troop");
    run(o, b, 0.3);
    o.leave();
    // The home diorama: the same battle, synced and rendered with no time passing.
    for (let i = 0; i < 30; i++) {
      o.sync(b, "player", 0, false);
      o.render(0, 1, false);
    }
    expect(o.parts).toMatchObject({ shown: false, pocketOnly: false, reveals: [], callout: false, mode: null });
    expect(o.callout()).toBeNull();
    expect(o.mesh.visible).toBe(false);
    // Back in a battle, the map works as before (and nothing replays for the lane that was already open).
    o.hold("troop");
    run(o, b, 0.2);
    expect(o.parts).toMatchObject({ shown: true, reveals: [], open: { left: true, right: false } });
    expect(o.mesh.visible).toBe(true);
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

  it("knows the guest's enemy half and King: the lit fill, cross-fade and pocket mask follow uSideSign", () => {
    // The texture is right in either view (the grid tests), but the shader's
    // cosmetics read `theirs = uSideSign * (16 - y)`: an unflipped sign would
    // light the guest's OWN half as the "new pocket".
    const o = new DeployOverlay({ golden: false });
    const u = uniforms(o);
    const king = (): number[] => (u.uKing.value as THREE.Vector2).toArray();
    expect(u.uSideSign.value).toBe(1);
    expect(king()).toEqual([9, 2.5]);
    o.setView("enemy");
    expect(u.uSideSign.value).toBe(-1);
    expect(king()).toEqual([9, 29.5]);
    o.setView("player");
    expect(u.uSideSign.value).toBe(1);
    expect(king()).toEqual([9, 2.5]);
    // A sync from the guest's side sets the view by itself.
    o.sync(createBattle(), "enemy", DT, false);
    expect(u.uSideSign.value).toBe(-1);
    expect(king()).toEqual([9, 29.5]);
  });

  it("grows each view's reveal from that view's ruin", () => {
    for (const side of ["player", "enemy"] as Side[]) {
      const o = new DeployOverlay({ golden: false });
      const b = createBattle();
      run(o, b, 0.2, false, side);
      fell(b, side === "player" ? "enemy" : "player", "right");
      run(o, b, 1.0, false, side);
      const w = uniforms(o).uWaveR.value as THREE.Vector3;
      const ruin = ruinSpot(side, "right");
      expect([w.x, w.y]).toEqual([ruin.x, ruin.y]);
      expect(w.z).toBeGreaterThan(0);
      expect(w.z).toBeLessThan(REVEAL_DONE);
    }
  });

  it("builds the shader's geometry from the sim's exported constants", () => {
    const frag = (new DeployOverlay({ golden: false }).mesh.material as THREE.ShaderMaterial).fragmentShader;
    const f = glslFloat;
    expect(f(16)).toBe("16.0");
    expect(f(3.5)).toBe("3.5");
    expect(frag).toContain(`uSideSign * (${f(RIVER_Y)} - vTile.y)`);
    expect(frag).toContain(`bool isL = vTile.x < ${f(ARENA_WIDTH / 2)};`);
    for (const bx of BRIDGE_XS) expect(frag).toContain(`abs(vTile.x - ${f(bx)}) <= ${f(BRIDGE_HALF_WIDTH)}`);
    expect(frag).toContain(`abs(vTile.y - ${f(RIVER_Y)}) < ${f(RIVER_HALF_WIDTH)}`);
    expect(frag).toContain(`step(length(vTile - uKing), ${f(KING_KEEP_CLEAR + 0.2)})`);
    expect(frag).toContain(`texture2D(uField, vTile / vec2(${f(ARENA_WIDTH)}, ${f(ARENA_HEIGHT)}))`);
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
    // The real looks: only the Classic forge is dark enough (its grade renders it near black by night).
    const light = Object.values(LOOKS).filter((l) => (o.setLook(l), o.lightStripes)).map((l) => l.id);
    expect(light).toEqual(["forge"]);
    // Golden Age courts are judged by their plaster, and every one keeps ink stripes.
    for (const l of Object.values(ISLAMIC_LOOKS)) {
      expect(floorSwatch(l)).toBe(l.islamic!.plaster);
      o.setLook(l);
      expect(o.lightStripes, l.id).toBe(false);
    }
  });

  it("gives the ink stripes of mid-dark floors a light hairline that comes with the night", () => {
    const o = new DeployOverlay({ golden: false });
    const edged = (looks: Record<string, Parameters<DeployOverlay["setLook"]>[0] & { id: string }>): string[] =>
      Object.values(looks)
        .filter((l) => (o.setLook(l), o.nightEdges))
        .map((l) => l.id)
        .sort();
    // The looks whose ink stripes all but vanished by night in the review's look sheet.
    expect(edged(LOOKS)).toEqual(["jungle", "mystic", "swamp"]);
    expect(edged(ISLAMIC_LOOKS)).toEqual(["copper", "medina", "souk"]);
    // Never on the forge (its stripes are light already) or a pale floor.
    o.setLook(LOOKS.forge);
    expect(o.nightEdges).toBe(false);
    o.setLook(LOOKS.meadow);
    expect(o.nightEdges).toBe(false);
    // The hairline fades in with the night, from nothing by day.
    o.setLook(LOOKS.swamp);
    o.hold("troop");
    o.sync(createBattle(), "player", DT, false);
    o.render(0, 1, false);
    expect(uniforms(o).uEdgeA.value).toBe(0);
    o.render(0.5, 1, false);
    expect(uniforms(o).uEdgeA.value).toBeCloseTo(NIGHT_EDGE_ALPHA * 0.5, 6);
    o.render(1, 1, false);
    expect(uniforms(o).uEdgeA.value).toBeCloseTo(NIGHT_EDGE_ALPHA, 6);
    o.setLook(LOOKS.meadow);
    o.render(1, 1, false);
    expect(uniforms(o).uEdgeA.value).toBe(0);
  });

  it("lights the Golden Age pocket brighter than the sand, calmer by night", () => {
    const lit = (golden: boolean): { fill: (day: number) => number; luma: number } => {
      const o = new DeployOverlay({ golden });
      o.hold("troop");
      o.sync(createBattle(), "player", DT, false);
      const c = uniforms(o).uLit.value as THREE.Color;
      const s = c.clone().convertLinearToSRGB();
      return {
        fill: (day: number) => (o.render(day, 1, false), uniforms(o).uFill.value as number),
        luma: 0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b,
      };
    };
    const g = lit(true);
    const c = lit(false);
    expect(g.fill(0)).toBe(FILL_GOLDEN);
    expect(c.fill(0)).toBe(FILL_CLASSIC);
    expect(FILL_GOLDEN).toBeGreaterThan(FILL_CLASSIC);
    expect(c.fill(1)).toBeCloseTo(FILL_CLASSIC * (1 - NIGHT_FILL_CUT), 6);
    expect(g.fill(1)).toBeCloseTo(FILL_GOLDEN * (1 - NIGHT_FILL_CUT_GOLDEN), 6);
    expect(g.fill(1)).toBeLessThanOrEqual(c.fill(1)); // brighter by day, never milkier by night
    // Lighter than every Golden Age plaster: a tint that only shifts the hue does not read as lit.
    for (const l of Object.values(ISLAMIC_LOOKS)) expect(g.luma, l.id).toBeGreaterThan(srgbLuma(floorSwatch(l)) + 0.1);
  });

  it("draws the Digger's collars with a bolder line (they hide mostly under the towers)", () => {
    const o = new DeployOverlay({ golden: false });
    const b = createBattle();
    o.hold("troop");
    o.sync(b, "player", DT, false);
    o.render(0, 1, false);
    expect(uniforms(o).uThick.value).toBe(1);
    o.hold("dig");
    o.sync(b, "player", DT, false);
    o.render(0, 1, false);
    expect(uniforms(o).uThick.value).toBe(DIG_THICK);
    o.refuse("dig", 3.5, 6.5);
    o.render(0, 1, false);
    expect(uniforms(o).uThick.value).toBeCloseTo(DIG_THICK * 1.35, 6);
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

describe("what the GPU reads is checkDeploy's map (the overlay's own texture choice)", () => {
  // The deployZone grid test pins the painted shapes; this pins which one the
  // overlay hands the GPU: the troop cache picked by troopKey, the Digger's
  // repaint, and a switch of viewpoint (one overlay, every state in turn).
  const HAND: CardId[] = ["knight", "cannon", "digger", "fireball"];
  function stage(view: Side, left: boolean, right: boolean): BattleState {
    const b = createBattle();
    const hands = (): void => {
      for (const s of [b.player, b.enemy]) {
        s.hand = { cards: [...HAND], queue: [] };
        s.elixir = { amount: 10 };
      }
    };
    hands();
    expect(deployCard(b, "player", "cannon", 6, 22)).toBe(true);
    expect(deployCard(b, "enemy", "cannon", 12, 10)).toBe(true);
    hands();
    const owner: Side = view === "player" ? "enemy" : "player";
    if (left) fell(b, owner, "left");
    if (right) fell(b, owner, "right");
    return b;
  }

  it("agrees on a 0.25-tile grid for both views, every lane state, a troop, a building and the Digger", () => {
    const o = new DeployOverlay({ golden: false });
    const order: Side[] = ["player", "enemy", "enemy", "player"]; // switch views both ways, and stay
    let checked = 0;
    const bad: string[] = [];
    for (const view of order) {
      for (const [left, right] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ] as const) {
        const b = stage(view, left, right);
        for (const [card, mode] of [
          ["knight", "troop"],
          ["cannon", "troop"],
          ["digger", "dig"],
        ] as const) {
          o.hold(mode);
          o.sync(b, view, DT, false);
          o.render(0, 1, false);
          for (let j = 0; j <= 32 * 4; j++) {
            for (let i = 0; i <= 18 * 4; i++) {
              const x = i / 4;
              const y = j / 4;
              const drawn = o.sample(x, y);
              if (Math.abs(drawn) < 0.1) continue; // on an edge: bilinear + 8-bit
              checked++;
              const rule = checkDeploy(b, view, card, x, y) !== "bad-spot";
              if (drawn > 0 !== rule && bad.length < 5) bad.push(`${view} L${+left}R${+right} ${card} (${x},${y}) drawn=${drawn.toFixed(2)} rule=${rule}`);
            }
          }
          o.hold(null);
          run(o, b, 0.2, false, view); // the map fades out before the next card
        }
      }
    }
    expect(checked).toBeGreaterThan(300_000);
    expect(bad).toEqual([]);
  });
});
