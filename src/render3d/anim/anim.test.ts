import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CARDS, DECK, SPEED_TILES_PER_SEC, getCard, type CardId } from "../../game/cards";
import { animateTroop, buildTroop } from "../characters3d";
import { FxApi } from "../scene/fx/api";
import {
  KNOCK_EASE,
  SIM_DT,
  SNAP_DIST,
  animClock,
  clampAlpha,
  lerpSnap,
  pushSample,
  sampleTrack,
  type InterpTrack,
} from "./interp";
import {
  ARCHETYPES,
  ISLAMIC_ARCHETYPES,
  MAX_WINDUP,
  STRIKE_TIME,
  archetypeFor,
  attackSwing,
  championArchetype,
  newSwingPose,
  windupTime,
} from "./archetypes";
import { BASE_CADENCE, gaitCadence, hopScale, legPhases, stepSquash } from "./gait";
import { BLINK_MAX_GAP, BLINK_MIN_GAP, blinkShut, blinkStarts, faceOf, newBlinkClock, poseFace } from "./face";
import { KO_TIME, SHATTER_TIME, koPose, shatterCap, startDeath, stepDeath, type KoPose } from "./deaths";

const ALL_IDS = Object.keys(CARDS) as CardId[];

describe("interpolation", () => {
  it("blends the last two sim positions by alpha", () => {
    const out = { x: 0, z: 0 };
    lerpSnap(0, 0, 1, -0.5, 0.25, out);
    expect(out.x).toBeCloseTo(0.25);
    expect(out.z).toBeCloseTo(-0.125);
    lerpSnap(2, 2, 3, 2, 1, out);
    expect(out.x).toBe(3);
  });

  it("snaps instead of sliding across a jump longer than 1.4 tiles", () => {
    const out = { x: 0, z: 0 };
    lerpSnap(0, 0, SNAP_DIST + 0.01, 0, 0.1, out);
    expect(out.x).toBe(SNAP_DIST + 0.01);
    lerpSnap(0, 0, 1, 1, 0.5, out); // 1.414 > 1.4: snap
    expect(out.x).toBe(1);
    lerpSnap(0, 0, 1.39, 0, 0.5, out); // just inside: blend
    expect(out.x).toBeCloseTo(0.695);
  });

  it("clamps alpha into [0, 1] and survives NaN", () => {
    expect(clampAlpha(-0.3)).toBe(0);
    expect(clampAlpha(1.7)).toBe(1);
    expect(clampAlpha(0.4)).toBe(0.4);
    expect(clampAlpha(Number.NaN)).toBe(0);
    const out = { x: 0, z: 0 };
    lerpSnap(0, 0, 1, 0, 3, out);
    expect(out.x).toBe(1);
  });

  it("shifts samples only on a new tick, and eases a shove in over 0.12 s", () => {
    const tr: InterpTrack = {};
    const out = { x: 0, z: 0 };
    expect(pushSample(tr, 0, 0, 0, 0.1)).toBe("snap"); // first sight
    expect(pushSample(tr, 0.05, 0, SIM_DT, 0.1)).toBe("step");
    expect(tr.prevX).toBe(0);
    expect(tr.curX).toBe(0.05);
    expect(pushSample(tr, 0.05, 0, SIM_DT, 0.1)).toBe("same"); // same tick
    expect(tr.prevX).toBe(0);
    sampleTrack(tr, 0.5, 0.016, out);
    expect(out.x).toBeCloseTo(0.025);
    // A 0.8-tile spell knockback in one tick is eased, not popped.
    expect(pushSample(tr, 0.85, 0, 2 * SIM_DT, 0.1)).toBe("knock");
    sampleTrack(tr, 0, 0.016, out);
    expect(out.x).toBeGreaterThan(0.025);
    expect(out.x).toBeLessThan(0.85);
    sampleTrack(tr, 0, KNOCK_EASE, out);
    expect(out.x).toBeCloseTo(0.85);
    // A leap snaps.
    expect(pushSample(tr, 3, 0, 3 * SIM_DT, 0.1)).toBe("snap");
    sampleTrack(tr, 0.3, 0.016, out);
    expect(out.x).toBe(3);
  });

  it("advances the animation clock by alpha, and holds it during hit-stop", () => {
    expect(animClock(0, 2, 0.5, false)).toBeCloseTo(2 + 0.5 * SIM_DT);
    expect(animClock(0, 2, 7, false)).toBeCloseTo(2 + SIM_DT);
    let t = animClock(0, 2, 0.5, false);
    for (let i = 0; i < 5; i++) t = animClock(t, 2 + i * SIM_DT, 0.9, true);
    expect(t).toBeCloseTo(2 + 0.5 * SIM_DT);
  });
});

describe("attack archetypes", () => {
  it("covers every CardId", () => {
    for (const id of ALL_IDS) {
      expect(ARCHETYPES[id], id).toBeDefined();
      expect(archetypeFor(id).attackStyle).toBeTruthy();
    }
    expect(Object.keys(ARCHETYPES).sort()).toEqual([...ALL_IDS].sort());
    expect(new Set(DECK)).toEqual(new Set(ALL_IDS));
  });

  it("ranged troops shoot or cast; melee troops never do", () => {
    for (const id of ALL_IDS) {
      const card = getCard(id);
      if (card.kind !== "troop" || id === "champion") continue;
      const style = ARCHETYPES[id].attackStyle;
      if (card.unit.attackRange >= 2) expect(["shoot", "cast"], id).toContain(style);
      else expect(["shoot", "cast"], id).not.toContain(style);
    }
  });

  it("gives the named heroes their signature moves", () => {
    expect(ARCHETYPES.valkyrie.attackStyle).toBe("spin");
    expect(ARCHETYPES.prince.attackStyle).toBe("thrust");
    expect(ARCHETYPES.wizard.attackStyle).toBe("cast");
    expect(ARCHETYPES.witch.attackStyle).toBe("cast");
    expect(ARCHETYPES.musketeer.attackStyle).toBe("shoot");
    for (const id of ["giant", "pekka", "mega-knight"] as const) {
      expect(ARCHETYPES[id]).toMatchObject({ attackStyle: "slam", weight: "heavy" });
    }
    expect(ARCHETYPES["hog-rider"].quad).toBe("bound");
    expect(archetypeFor(null).attackStyle).toBe("shoot"); // tower crews
    // The Islamic militia carry spears.
    expect(archetypeFor("skeletons", { arabic: true })).toBe(ISLAMIC_ARCHETYPES.skeletons);
  });

  it("derives a champion's style from its build", () => {
    expect(championArchetype({ range: 6, hp: 800 }).attackStyle).toBe("shoot");
    expect(championArchetype({ range: 0.8, hp: 3000 })).toMatchObject({ attackStyle: "slam", weight: "heavy" });
    expect(championArchetype({ range: 0.8, hp: 300 }).weight).toBe("light");
    expect(archetypeFor("champion", { champion: { range: 6, hp: 800 } }).attackStyle).toBe("shoot");
  });

  it("scales the windup with hit speed, capped at 0.45 s", () => {
    expect(windupTime(1.2)).toBeCloseTo(0.36);
    expect(windupTime(1.8)).toBe(MAX_WINDUP);
    expect(windupTime(1.2)).toBeLessThan(windupTime(1.8));
    for (let hs = 0.3; hs < 4; hs += 0.1) {
      expect(windupTime(hs)).toBeLessThanOrEqual(MAX_WINDUP);
      expect(windupTime(hs) + STRIKE_TIME).toBeLessThan(hs); // never overlaps the strike
    }
  });

  it("winds up, holds the peak on the last tick, strikes, then readies", () => {
    const p = newSwingPose();
    const hs = 1.2;
    const w = windupTime(hs);
    expect(attackSwing(w + 0.1, hs, true, "chop", p).ready).toBe(1);
    expect(attackSwing(w * 0.5, hs, true, "chop", p).windup).toBeGreaterThan(0);
    expect(attackSwing(w * 0.5, hs, true, "chop", p).windup).toBeLessThan(1);
    expect(attackSwing(SIM_DT, hs, true, "chop", p).windup).toBe(1); // held peak
    expect(attackSwing(SIM_DT * 0.4, hs, true, "chop", p).windup).toBe(1);
    expect(attackSwing(SIM_DT, hs, true, "chop", p).swing).toBeLessThan(0);
    const hit = attackSwing(hs, hs, true, "chop", p); // the blow just landed
    expect(hit.strike).toBe(1);
    expect(hit.swing).toBe(1);
    expect(attackSwing(hs - STRIKE_TIME * 0.5, hs, true, "chop", p).strike).toBeLessThan(1);
    // Out of reach between blows: nothing.
    expect(attackSwing(w * 0.5, hs, false, "chop", p).swing).toBe(0);
  });
});

describe("gaits", () => {
  const scaleOf = { giant: 1.48, "hog-rider": 1.25, knight: 1.25 };
  const speed = (id: CardId): number => {
    const c = getCard(id);
    return c.kind === "spell" ? 0 : SPEED_TILES_PER_SEC[c.unit.speed];
  };

  it("matches stride rate to speed and size: a Giant plods, a Hog scampers", () => {
    const giant = gaitCadence(speed("giant"), scaleOf.giant);
    const hog = gaitCadence(speed("hog-rider"), scaleOf["hog-rider"]);
    expect(giant).toBeLessThan(hog);
    expect(gaitCadence(speed("knight"), scaleOf.knight)).toBeCloseTo(BASE_CADENCE);
    expect(gaitCadence(1.1, 2)).toBeLessThan(gaitCadence(1.1, 1)); // bigger = slower
  });

  it("bounces light units more than heavies, which squash on every step", () => {
    expect(hopScale("light")).toBeGreaterThan(hopScale("medium"));
    expect(hopScale("heavy")).toBeLessThan(hopScale("medium"));
    expect(stepSquash("heavy")).toBeCloseTo(0.04);
    expect(stepSquash("light")).toBe(0);
  });

  it("orders four legs as a trot or a bound", () => {
    expect(legPhases(4, "trot")).toEqual([0, Math.PI, Math.PI / 2, (3 * Math.PI) / 2]);
    expect(legPhases(4)).toEqual([0, Math.PI, Math.PI / 2, (3 * Math.PI) / 2]);
    expect(legPhases(4, "bound")).toEqual([0, 0, Math.PI, Math.PI]);
    expect(legPhases(2)).toEqual([0, Math.PI]);
  });

  it("drives a four-legged mount's legs out of phase", () => {
    const rig = buildTroop("prince");
    animateTroop(rig, { moving: true, swing: 0, time: 0, phase: 0, stride: 0.4, quad: "trot" });
    const r = rig.legs!.map((l) => l.rotation.x);
    expect(r[0]).toBeCloseTo(Math.sin(0.4) * 0.7);
    expect(r[1]).toBeCloseTo(Math.sin(0.4 + Math.PI) * 0.7);
    expect(r[2]).toBeCloseTo(Math.sin(0.4 + Math.PI / 2) * 0.7);
    expect(r[3]).toBeCloseTo(Math.sin(0.4 + 1.5 * Math.PI) * 0.7);
  });
});

describe("attack poses", () => {
  it("a shooter keeps its aim and kicks back", () => {
    const rig = buildTroop("musketeer");
    animateTroop(rig, { moving: false, swing: 0, time: 0, phase: 0, style: "shoot" });
    const arm = rig.arm!.rotation.x;
    animateTroop(rig, { moving: false, swing: 1, time: 0, phase: 0, style: "shoot" });
    expect(rig.arm!.rotation.x).toBeCloseTo(arm);
    expect(rig.group.position.z).toBeCloseTo(-0.1);
    expect(rig.group.scale.y / rig.group.scale.x).toBeLessThan(1);
  });

  it("a spinner whirls a full turn through the strike", () => {
    const rig = buildTroop("valkyrie");
    animateTroop(rig, { moving: false, swing: 0.675, time: 0, phase: 0, style: "spin" });
    expect(rig.group.rotation.y).toBeCloseTo(Math.PI);
  });

  it("a thruster lunges along its facing", () => {
    const rig = buildTroop("prince");
    animateTroop(rig, { moving: false, swing: 1, time: 0, phase: 0, style: "thrust" });
    expect(rig.group.position.z).toBeCloseTo(0.15);
  });

  it("a slammer stretches in the windup and squashes on impact", () => {
    const rig = buildTroop("pekka");
    const base = rig.group.scale.x;
    animateTroop(rig, { moving: false, swing: -0.7, windup: 1, time: 0, phase: 0, style: "slam" });
    expect(rig.group.scale.y / base).toBeGreaterThan(1.04);
    animateTroop(rig, { moving: false, swing: 1, time: 0, phase: 0, style: "slam" });
    expect(rig.group.scale.y / base).toBeLessThan(0.9);
    // The rest scale is remembered, so squashes never drift.
    animateTroop(rig, { moving: false, swing: 0, time: 0, phase: 0, style: "slam" });
    expect(rig.group.scale.x).toBeCloseTo(base);
  });

  it("a caster raises both arms and its orb swells in the windup", () => {
    const rig = buildTroop("ice-wizard");
    animateTroop(rig, { moving: false, swing: 0, time: 0, phase: 0, style: "cast" });
    const orb = rig.group.getObjectByName("orb")!;
    expect(orb).toBeDefined();
    const rest = orb.scale.x;
    const armRest = rig.arm!.rotation.x;
    const offRest = rig.offArm!.rotation.x;
    animateTroop(rig, { moving: false, swing: -0.7, windup: 1, time: 0, phase: 0, style: "cast" });
    expect(orb.scale.x / rest).toBeCloseTo(1.4);
    expect(rig.arm!.rotation.x).toBeLessThan(armRest - 1);
    expect(rig.offArm!.rotation.x).toBeLessThan(offRest - 1);
  });

  it("the ready stance bobs the weapon at 2 Hz", () => {
    const rig = buildTroop("knight");
    const at = (t: number): number => {
      animateTroop(rig, { moving: false, swing: 0, time: t, phase: 0, ready: 1 });
      return rig.arm!.rotation.x;
    };
    expect(at(0.125)).not.toBeCloseTo(at(0.375));
    expect(at(0.125)).toBeCloseTo(at(0.625));
  });
});

describe("faces", () => {
  it("blinks on a schedule that is deterministic per seed", () => {
    const a = blinkStarts(17, 12);
    expect(blinkStarts(17, 12)).toEqual(a);
    expect(blinkStarts(18, 12)).not.toEqual(a);
    for (let i = 1; i < a.length; i++) {
      const gap = a[i] - a[i - 1];
      expect(gap).toBeGreaterThanOrEqual(BLINK_MIN_GAP);
      expect(gap).toBeLessThanOrEqual(BLINK_MAX_GAP);
    }
    // The running clock agrees with the pure schedule.
    const c = newBlinkClock(17);
    for (const start of a) {
      expect(blinkShut(c, start + 0.04)).toBe(true);
      expect(blinkShut(c, start + 0.2)).toBe(false);
    }
  });

  it("finds the named face parts and shows X-eyes on a knockout", () => {
    const rig = buildTroop("knight");
    const face = faceOf(rig.group)!;
    expect(face.eyes.length).toBe(2);
    expect(face.pupils.length).toBe(2);
    expect(face.brows.length).toBe(2);
    expect(face.mouths.length).toBe(1);
    poseFace(face, { blink: true, squint: 0, anger: 0, ko: false });
    expect(face.eyes[0].scale.y).toBeCloseTo(0.1);
    poseFace(face, { blink: false, squint: 0, anger: 1, ko: false });
    expect(face.eyes[0].scale.y).toBe(1);
    expect(face.mouths[0].mesh.scale.y).toBeGreaterThan(2);
    poseFace(face, { blink: false, squint: 0, anger: 0, ko: true });
    expect(face.pupils.every((p) => !p.visible)).toBe(true);
    expect(face.xEyes?.length).toBe(2);
    expect(face.xEyes!.every((x) => x.visible && x.children.length === 2)).toBe(true);
    // Geometry and material are shared across every knocked-out face.
    const bar = face.xEyes![0].children[0] as THREE.Mesh;
    expect(bar.geometry.userData.shared).toBe(true);
    expect((bar.material as THREE.Material).userData.shared).toBe(true);
  });

  it("rigs without an addEyes face are left alone", () => {
    // (The test env runs the Islamic edition, where skeletons and P.E.K.K.A
    // are people; bats have glowing eyes but no blinking face either.)
    expect(faceOf(buildTroop("bats").group)).toBeNull();
    expect(faceOf(new THREE.Group())).toBeNull();
  });
});

describe("death motions", () => {
  const fx: FxApi = { emit: () => {}, decal: () => {}, update: () => {}, reset: () => {} };
  const pose = (): KoPose => ({ tilt: 0, lift: 0, sink: 0, shrink: 1, down: false });

  it("knocks a body flat, bounces once, then sinks and shrinks to nothing", () => {
    expect(koPose(0, pose()).tilt).toBe(0);
    expect(koPose(0.18, pose()).tilt).toBeCloseTo(Math.PI / 2);
    expect(koPose(0.26, pose()).tilt).toBeLessThan(Math.PI / 2); // the bounce
    expect(koPose(0.26, pose()).down).toBe(true);
    expect(koPose(0.5, pose()).tilt).toBe(Math.PI / 2);
    expect(koPose(0.5, pose()).shrink).toBe(1);
    expect(koPose(KO_TIME, pose()).shrink).toBeCloseTo(0);
  });

  it("topples the root toward the recoil direction", () => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const d = startDeath({
      motion: "ko", root, body, dirX: 1, dirZ: 0, fall: 0, height: 1.5, face: null,
      marks: [], ax: 9, ay: 16, fx, seed: 1, activeParts: 0,
    });
    stepDeath(d, root, 0.3, 0.016);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
    expect(up.x).toBeGreaterThan(0.9);
  });

  it("shatters a skeleton into pieces that stay under the root and shrink away", () => {
    const rig = buildTroop("skeletons");
    const root = new THREE.Group();
    root.add(rig.group);
    const d = startDeath({
      motion: "shatter", root, body: rig.group, dirX: 0, dirZ: 1, fall: 0, height: 1, face: null,
      marks: [], ax: 9, ay: 16, fx, seed: 3, activeParts: 0,
    });
    expect(d.parts!.length).toBeGreaterThan(4);
    for (const p of d.parts!) expect(p.obj.parent).toBe(root);
    const y0 = d.parts!.map((p) => p.obj.position.y);
    for (let t = 0; t < 0.2; t += 0.02) stepDeath(d, root, t, 0.02);
    expect(d.parts!.some((p, i) => p.obj.position.y > y0[i])).toBe(true); // launched
    stepDeath(d, root, SHATTER_TIME, 0.02);
    for (const p of d.parts!) expect(p.obj.scale.x).toBe(0);
  });

  it("caps the shards in flight at 300 x particleScale", () => {
    const rig = buildTroop("pekka");
    const root = new THREE.Group();
    root.add(rig.group);
    const d = startDeath({
      motion: "shatter", root, body: rig.group, dirX: 0, dirZ: 1, fall: 0, height: 1, face: null,
      marks: [], ax: 9, ay: 16, fx, seed: 3, activeParts: shatterCap() - 6,
    });
    expect(d.parts!.length).toBeLessThanOrEqual(6);
    const full = startDeath({
      motion: "shatter", root: new THREE.Group(), body: buildTroop("pekka").group, dirX: 0, dirZ: 1,
      fall: 0, height: 1, face: null, marks: [], ax: 9, ay: 16, fx, seed: 3, activeParts: shatterCap(),
    });
    expect(full.motion).toBe("ko"); // no budget left: falls over instead
  });
});

describe("module boundaries", () => {
  it("nothing under render3d/anim imports the network layer", () => {
    const sources = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as Record<
      string,
      string
    >;
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    for (const [file, src] of Object.entries(sources)) {
      if (file.endsWith(".test.ts")) continue;
      expect(src, file).not.toMatch(/from\s+["'][^"']*\/net\//);
    }
  });
});
