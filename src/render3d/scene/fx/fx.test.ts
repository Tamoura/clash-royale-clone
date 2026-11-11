import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { SALVO_RADIUS } from "../../../game/abilities";
import { CARDS, getCard, type CardId } from "../../../game/cards";
import { setPrefs } from "../../../ui/prefs";
import type { ParticleSpec } from "../../particles";
import battleSource from "../../../game/battle.ts?raw";
import { CELL_COUNT, DECAL_CELL, cellRect, decalRect } from "./atlas";
import { DECAL_CAP, DecalLayer, pickDecalSlot } from "./decals";
import { GLYPHS, layoutGlyphs } from "./glyphs";
import { domeAlpha, domeGrow } from "./iceDome";
import { ADD_CAP, ALPHA_CAP, VfxPool, type VfxHost } from "./pool";
import { PRESETS, PRESET_NAMES, emitPreset, type PoolKind, type Range } from "./presets";
import { EWIZ_ZAP_RADIUS, MEGA_SLAM_RADIUS, castAbility, castSpell, spellRadius } from "./spells";

// The quality ladder is render-core's; pin its particle scale per test.
const q = vi.hoisted(() => ({ scale: 1 }));
vi.mock("../../quality", () => ({ particleScale: () => q.scale }));

// vitest runs in node: give the atlases a do-nothing 2D canvas and count
// every canvas the code asks for.
let canvases = 0;
function fakeContext(w: number, h: number): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  return new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "getImageData") return (_x: number, _y: number, cw: number, ch: number) => ({ data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch });
      if (prop === "measureText") return () => ({ width: 52 });
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => gradient;
      if (prop === "canvas") return { width: w, height: h };
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "canvas") canvases++;
      const el = { width: 300, height: 150, getContext: () => fakeContext(el.width, el.height) };
      return el;
    },
  });
});
afterEach(() => {
  q.scale = 1;
  setPrefs({ reduceMotion: "auto" });
});

function host(): VfxHost & { flashes: number[]; shakes: number[] } {
  const h = {
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(-10, 10, 18, -18, -50, 120),
    container: { clientWidth: 390 },
    flashes: [] as number[],
    shakes: [] as number[],
    shake(a: number) {
      h.shakes.push(a);
    },
    setFlash(a: number) {
      h.flashes.push(a);
    },
  };
  return h;
}

const min = (r: Range): number => (typeof r === "number" ? r : Math.min(r[0], r[1]));

/** Ids are global counters: the next id minus the last one is what was made. */
function nextIds(): { geo: number; mat: number; tex: number } {
  return { geo: new THREE.BufferGeometry().id, mat: (new THREE.Material() as THREE.Material & { id: number }).id, tex: new THREE.Texture().id };
}

describe("particle atlas", () => {
  it("cellRect maps an index to its 8x8 cell (row 0 at the top, flipY)", () => {
    expect(cellRect(0)).toEqual({ u0: 0, v0: 7 / 8, u1: 1 / 8, v1: 1 });
    expect(cellRect(9)).toEqual({ u0: 1 / 8, v0: 6 / 8, u1: 2 / 8, v1: 7 / 8 });
    expect(cellRect(63)).toEqual({ u0: 7 / 8, v0: 0, u1: 1, v1: 1 / 8 });
  });

  it("cells tile the atlas without overlapping", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) {
      const r = cellRect(i);
      expect(r.u1 - r.u0).toBeCloseTo(1 / 8);
      expect(r.v1 - r.v0).toBeCloseTo(1 / 8);
      expect(Math.min(r.u0, r.v0)).toBeGreaterThanOrEqual(0);
      expect(Math.max(r.u1, r.v1)).toBeLessThanOrEqual(1);
      seen.add(`${r.u0},${r.v0}`);
    }
    expect(seen.size).toBe(64);
    expect(CELL_COUNT).toBeLessThanOrEqual(64);
    expect(decalRect(DECAL_CELL.rune)).toEqual({ u0: 3 / 4, v0: 0, u1: 1, v1: 1 / 2 });
  });
});

describe("presets", () => {
  it("every preset is valid: cells in range, positive life and counts", () => {
    for (const name of PRESET_NAMES) {
      for (const L of PRESETS[name]) {
        const cells = typeof L.cell === "number" ? [L.cell] : L.cell;
        for (const c of cells) {
          expect(c, name).toBeGreaterThanOrEqual(0);
          expect(c, name).toBeLessThan(CELL_COUNT);
        }
        expect(min(L.life), name).toBeGreaterThan(0);
        expect(L.count, name).toBeGreaterThan(0);
        expect(min(L.size0), name).toBeGreaterThanOrEqual(0);
        expect(min(L.size1), name).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keeps the names other packages emit", () => {
    for (const n of ["dust", "smoke", "smoke-column", "chips", "ring", "deployPuff", "hitSpark", "crit", "muzzle", "boneShards", "embers", "snow", "frost-mist", "heal-plus", "rage-ember", "confetti", "debris"]) {
      expect(PRESETS[n], n).toBeDefined();
    }
    expect(DECAL_CELL.crater).toBeDefined();
  });

  it("emitted particles are alive and drawable", () => {
    const got: Array<{ kind: PoolKind; life: number; cell: number }> = [];
    const sp = {
      spawn: (kind: PoolKind, s: ParticleSpec) => got.push({ kind, life: s.life, cell: s.cell }),
      rand: Math.random,
      scale: () => 1,
    };
    for (const name of PRESET_NAMES) expect(emitPreset(sp, name, 0, 0, 0, { radius: 2, color: 0xff0000 })).toBe(true);
    expect(emitPreset(sp, "no-such-preset", 0, 0, 0)).toBe(false);
    expect(got.length).toBeGreaterThan(100);
    for (const p of got) {
      expect(p.life).toBeGreaterThan(0);
      expect(p.cell).toBeGreaterThanOrEqual(0);
      expect(p.cell).toBeLessThan(CELL_COUNT);
    }
  });
});

describe("VfxPool", () => {
  it("draws every smoke, spark, ember and number in 4 calls or fewer", () => {
    const h = host();
    const v = new VfxPool(h);
    const instanced = h.scene.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh);
    expect(instanced).toHaveLength(4); // additive, alpha, glyphs, decals
    expect(v.add.mesh.material).not.toBe(v.alpha.mesh.material);
  });

  it("wraps its ring buffer without growing", () => {
    const v = new VfxPool(host());
    const before = (v.add.mesh.geometry.getAttribute("aPos").array as Float32Array).length;
    for (let i = 0; i < ADD_CAP + 300; i++) v.emitWorld("embers", 0, 0, 0, { count: 1 });
    v.update(1 / 60);
    expect(v.add.count).toBe(ADD_CAP);
    expect((v.add.mesh.geometry.getAttribute("aPos").array as Float32Array).length).toBe(before);
    expect(v.add.mesh.count).toBe(ADD_CAP);
  });

  it("keeps the live count at or below the cap over 2,000 emits", () => {
    const v = new VfxPool(host());
    for (let i = 0; i < 2000; i++) {
      v.emit(PRESET_NAMES[i % PRESET_NAMES.length], 9, 16);
      if (i % 50 === 0) v.update(1 / 60);
      expect(v.add.count).toBeLessThanOrEqual(ADD_CAP);
      expect(v.alpha.count).toBeLessThanOrEqual(ALPHA_CAP);
    }
  });

  it("uploads only the written ranges", () => {
    const v = new VfxPool(host());
    v.update(1 / 60);
    v.emitWorld("embers", 0, 0, 0); // 12 particles
    v.update(1 / 60);
    const ranges = (v.add.mesh.geometry.getAttribute("aPhys") as THREE.BufferAttribute).updateRanges;
    expect(ranges).toEqual([{ start: 0, count: 12 * 4 }]);
  });

  it("applies particleScale to the caps and the counts", () => {
    q.scale = 0.5;
    const v = new VfxPool(host());
    expect(v.add.ring.cap).toBe(ADD_CAP / 2);
    expect(v.alpha.ring.cap).toBe(ALPHA_CAP / 2);
    v.emitWorld("embers", 0, 0, 0); // 12 at full quality
    v.update(0);
    expect(v.add.count).toBe(6);
    for (let i = 0; i < 2000; i++) v.emitWorld("hitSpark", 0, 0, 0);
    v.update(0);
    expect(v.add.count).toBeLessThanOrEqual(ADD_CAP / 2);
    q.scale = 1; // quality restored live
    v.update(0);
    expect(v.add.ring.cap).toBe(ADD_CAP);
  });

  it("emits construct no geometry, material, texture or canvas after init", () => {
    const h = host();
    const v = new VfxPool(h);
    canvases = 0;
    const before = nextIds();
    for (const name of PRESET_NAMES) for (let i = 0; i < 200; i++) v.emit(name, 9, 16, { z: 1 });
    for (const id of Object.keys(CARDS) as CardId[]) {
      if (getCard(id).kind === "spell") castSpell(v, id, 9, 12, "player");
    }
    castAbility(v, "rally", 9, 29.5);
    castAbility(v, "restore", 9, 29.5);
    castAbility(v, "salvo", 9, 2.5);
    for (let i = 0; i < 100; i++) {
      v.popup(0, 1, 0, String(100 + i), 1.45, "#ffab40", i % 7 === 0);
      v.decal("scorch", 9, 16, 2.5);
    }
    v.crown(9, 6);
    v.emote("enemy", "x", -13.5);
    for (let f = 0; f < 120; f++) v.update(1 / 60);
    const after = nextIds();
    expect(after.geo - before.geo).toBe(1);
    expect(after.mat - before.mat).toBe(1);
    expect(after.tex - before.tex).toBe(1);
    expect(canvases).toBe(0);
  });

  it("popups lay '1234' out as 4 centred quads", () => {
    const quads = layoutGlyphs("1234", () => 0.6);
    expect(quads.map((g) => g.cell)).toEqual([1, 2, 3, 4]);
    expect(quads.map((g) => g.x)).toEqual([-0.9, -0.3, 0.3, 0.9].map((x) => expect.closeTo(x, 6)));
    const v = new VfxPool(host());
    const live = v.glyphs.layout("1234", false);
    expect(live).toHaveLength(4);
    expect(live[0].x).toBeCloseTo(-live[3].x);
    expect(live[1].x).toBeCloseTo(-live[2].x);
    const crit = v.glyphs.layout("750", true);
    expect(crit[0].cell).toBe(GLYPHS.indexOf("*"));
    v.popup(0, 1, 0, "1234", 1, "#ffffff");
    v.update(1 / 60);
    expect(v.glyphs.count).toBe(4);
  });

  it("decals recycle the one closest to its end past the cap", () => {
    expect(pickDecalSlot([5, 1, 3], [10, 10, 10], 4)).toBe(1); // equal lives: oldest
    expect(pickDecalSlot([5, 1, 3], [10, 1, 10], 4)).toBe(1); // a dead slot first
    expect(pickDecalSlot([5, 1, 3], [10, 600, 10], 4)).toBe(2); // least time left, not oldest
    const layer = new DecalLayer({ value: 0 }, false);
    const slots: number[] = [];
    for (let i = 0; i < DECAL_CAP; i++) slots.push(layer.add("scorch", 0, 0, 1, i * 0.01, { life: 8 }));
    expect(new Set(slots).size).toBe(DECAL_CAP);
    expect(layer.add("crater", 0, 0, 1, 1, { life: 8 })).toBe(slots[0]);
    expect(layer.add("crater", 0, 0, 1, 1.01, { life: 8 })).toBe(slots[1]);
    expect(layer.births.length).toBe(DECAL_CAP);
  });

  it("a long-lived crater survives a burst of short decals", () => {
    const layer = new DecalLayer({ value: 0 }, false);
    const crater = layer.add("crater", 0, 0, 1, 0, { life: 600 });
    for (let i = 0; i < 20; i++) {
      expect(layer.add(i % 2 ? "ring" : "scorch", 0, 0, 1, 0.5 + i * 0.05, { life: 7 })).not.toBe(crater);
    }
    expect(layer.lives[crater]).toBe(600);
    expect(layer.births[crater]).toBe(0);
  });
});

describe("spell recipes", () => {
  it("draw at the radius the sim applies", () => {
    for (const id of Object.keys(CARDS) as CardId[]) {
      const card = getCard(id);
      if (card.kind === "spell" && card.radius > 0) expect(spellRadius(id), id).toBe(card.radius);
    }
    expect(spellRadius("fireball", { salvo: true })).toBe(SALVO_RADIUS);
    // The two literals live in battle.ts deployCard; fail if they drift.
    const ewiz = /applySpell\(state, side, "zap", x, y, [\d.]+, ([\d.]+),/.exec(battleSource);
    const slam = /applySpell\(state, side, "mega-knight", x, y, [\d.]+, ([\d.]+),/.exec(battleSource);
    expect(Number(ewiz?.[1])).toBe(EWIZ_ZAP_RADIUS);
    expect(Number(slam?.[1])).toBe(MEGA_SLAM_RADIUS);
    expect(spellRadius("zap", { ewiz: true })).toBe(EWIZ_ZAP_RADIUS);
  });

  it("zap flashes for two frames, and never under reduced motion", () => {
    setPrefs({ reduceMotion: "off" });
    const h = host();
    const v = new VfxPool(h);
    castSpell(v, "zap", 9, 12, "player");
    for (let f = 0; f < 5; f++) v.update(1 / 60);
    expect(h.flashes.filter((a) => a > 0)).toHaveLength(2);
    expect(h.flashes[h.flashes.length - 1]).toBe(0);

    setPrefs({ reduceMotion: "on" });
    const h2 = host();
    const v2 = new VfxPool(h2);
    castSpell(v2, "zap", 9, 12, "player");
    castSpell(v2, "fireball", 9, 12, "player");
    for (let f = 0; f < 30; f++) v2.update(1 / 60);
    expect(h2.flashes.every((a) => a === 0)).toBe(true);
  });

  it("fireball shakes on impact, not at cast", () => {
    const h = host();
    const v = new VfxPool(h);
    castSpell(v, "fireball", 9, 12, "player");
    v.update(0.1);
    expect(h.shakes).toHaveLength(0);
    for (let f = 0; f < 20; f++) v.update(1 / 60);
    expect(h.shakes).toHaveLength(1);
  });

  it("the freeze dome grows in 0.5 s and fades out with the freeze", () => {
    expect(domeGrow(0)).toBeCloseTo(0);
    expect(domeGrow(0.5)).toBeCloseTo(1);
    expect(Math.max(...[0.2, 0.3, 0.4].map(domeGrow))).toBeGreaterThan(1); // overshoot
    expect(domeAlpha(1, 4)).toBeGreaterThan(0.5);
    expect(domeAlpha(4, 4)).toBe(0);
    const v = new VfxPool(host());
    castSpell(v, "freeze", 9, 12, "player");
    expect(v.domes.active).toBe(1);
    for (let f = 0; f < 300; f++) v.update(1 / 60);
    expect(v.domes.active).toBe(0);
  });

  it("reset clears everything in flight", () => {
    const h = host();
    const v = new VfxPool(h);
    castSpell(v, "freeze", 9, 12, "player");
    v.emit("smoke-column", 9, 12);
    v.update(1 / 60);
    v.reset();
    v.update(1 / 60);
    expect(v.add.count + v.alpha.count).toBe(0);
    expect(v.domes.active).toBe(0);
    expect(v.add.mesh.visible || v.alpha.mesh.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Toy Tournament (art bible 5 and 8): the bloom contract, puffs, stars,
// team rings, modelled projectiles and the damage numbers' merge and stack.
// ---------------------------------------------------------------------------

describe("bloom contract and toon FX", () => {
  it("only cores and sparks carry hdr above 1; flames, rings and puffs stay under", async () => {
    const { HOT_PRESETS, PLAIN_HDR_MAX } = await import("./presets");
    const over: string[] = [];
    for (const name of PRESET_NAMES) {
      for (const L of PRESETS[name]) {
        const hdr = Math.max(L.hdr0 ?? 1, L.hdr1 ?? L.hdr0 ?? 1);
        if (hdr <= PLAIN_HDR_MAX) continue;
        // A hot layer must be additive, belong to a core/spark preset and be small.
        if (!HOT_PRESETS.has(name) || L.pool !== "add") over.push(`${name}:${L.cell}`);
        else expect(Math.max(min(L.size0), min(L.size1)), name).toBeLessThanOrEqual(1.0);
        expect(hdr, name).toBeLessThanOrEqual(2.4);
      }
    }
    expect(over).toEqual([]);
  });

  it("puffs are outlined toon clouds, never opaque white", async () => {
    const { SMOKE_CELLS, CELL } = await import("./atlas");
    const hsl = { h: 0, s: 0, l: 0 };
    for (const name of PRESET_NAMES) {
      for (const L of PRESETS[name]) {
        const cells = typeof L.cell === "number" ? [L.cell] : L.cell;
        if (!cells.some((c) => SMOKE_CELLS.includes(c) || c === CELL.PUFF)) continue;
        expect(L.pool, name).toBe("alpha");
        new THREE.Color(L.color0).getHSL(hsl, THREE.SRGBColorSpace);
        // Light puffs (snowy frost) are see-through; nothing is an opaque white blob.
        if (hsl.l > 0.8) expect(L.alpha0 ?? 1, name).toBeLessThanOrEqual(0.6);
        expect(hsl.l, name).toBeLessThan(0.9);
      }
    }
  });

  it("single-target impact puffs stay at or under 1.2 tiles", async () => {
    const { IMPACT_PUFF_MAX } = await import("./presets");
    const sizes: number[] = [];
    const sp = {
      spawn: (_k: PoolKind, s: ParticleSpec) => sizes.push(Math.max(s.size0, s.size1)),
      rand: Math.random,
      scale: () => 1,
    };
    for (const name of ["dust", "dust-kick", "hitSpark"]) emitPreset(sp, name, 0, 0, 0, { radius: 1.3 });
    expect(Math.max(...sizes)).toBeLessThanOrEqual(IMPACT_PUFF_MAX);
  });

  it("a hit throws 4-6 inked star sprites", async () => {
    const { CELL } = await import("./atlas");
    const { hitStars } = await import("./effects");
    for (const p of [1, 4, 10, 18]) {
      const n = hitStars(p);
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(6);
      const stars: number[] = [];
      emitPreset({ spawn: (_k, s) => s.cell === CELL.STAR5 && stars.push(1), rand: Math.random, scale: () => 1 }, "hitSpark", 0, 0, 0, { count: n });
      expect(stars.length).toBe(n);
    }
  });

  it("floor dust takes the arena's floor colour", () => {
    const got: number[] = [];
    const sp = {
      spawn: (_k: PoolKind, s: ParticleSpec) => got.push(s.r0),
      rand: Math.random,
      scale: () => 1,
      floorColor: () => 0x00ff00,
    };
    emitPreset(sp, "dust", 0, 0, 0);
    expect(got.every((r) => r === 0)).toBe(true); // green: no red at all
  });

  it("screen flashes never pass 0.25", async () => {
    const { FX_MAX_FLASH } = await import("./pool");
    setPrefs({ reduceMotion: "off" });
    const h = host();
    const v = new VfxPool(h);
    v.flash(1, 2);
    castSpell(v, "zap", 9, 12, "player");
    for (let f = 0; f < 5; f++) v.update(1 / 60);
    expect(Math.max(...h.flashes)).toBeLessThanOrEqual(FX_MAX_FLASH);
    expect(FX_MAX_FLASH).toBeLessThanOrEqual(0.25);
  });

  it("every spell lays a ring in the caster's team colour at the true radius", async () => {
    const { fxTeamColor } = await import("./spells");
    for (const side of ["player", "enemy"] as const) {
      for (const id of Object.keys(CARDS) as CardId[]) {
        const card = getCard(id);
        if (card.kind !== "spell" || id === "comet") continue;
        const v = new VfxPool(host());
        const rings: Array<{ r: number; color?: number }> = [];
        const decal = v.decal.bind(v);
        v.decal = (kind, x, y, r, opts) => {
          if (kind === "ring") rings.push({ r, color: opts?.color });
          decal(kind, x, y, r, opts);
        };
        castSpell(v, id, 9, 12, side);
        expect(rings.length, `${id} ${side}`).toBeGreaterThanOrEqual(1);
        expect(rings[0].r, id).toBe(spellRadius(id));
        expect(rings[0].color, id).toBe(fxTeamColor(side));
      }
    }
    expect(fxTeamColor("player")).not.toBe(fxTeamColor("enemy"));
  });

  it("the spell ring's inner rim is a cream under the bloom threshold, and its fill is faint", async () => {
    const { RING_RIM, linearLuminance } = await import("./decals");
    expect(linearLuminance(RING_RIM)).toBeLessThan(0.85);
    const layer = new DecalLayer({ value: 0 }, false);
    const frag = (layer.mesh.material as THREE.ShaderMaterial).fragmentShader;
    expect(frag).not.toMatch(/mix\(col, vec3\(1\.0\), w\)/);
    const rim = new THREE.Color(RING_RIM);
    expect(frag).toContain(`vec3(${rim.r.toFixed(4)}, ${rim.g.toFixed(4)}, ${rim.b.toFixed(4)})`);
  });

  it("the fireball comet's ribbon is one ribbon (puffs at most half their size apart) gone soon after impact; its glow stays under the threshold", async () => {
    const { CELL } = await import("./atlas");
    const { FIREBALL_FALL, COMET_GLOW_HDR, COMET_CORE_HDR } = await import("./spells");
    const { RIBBON_LINGER, RIBBON_SPACING } = await import("./presets");
    expect(COMET_GLOW_HDR).toBeLessThanOrEqual(1);
    expect(COMET_CORE_HDR).toBeLessThanOrEqual(2.4);
    for (const scale of [1, 0.75, 0.5]) {
      q.scale = scale;
      const v = new VfxPool(host());
      const puffs: Array<{ x: number; y: number; z: number; size0: number; delay: number; end: number }> = [];
      const glows: Array<{ lum: number; size: number; cell: number }> = [];
      const spawn = v.spawn.bind(v);
      v.spawn = (pool, s) => {
        if (pool === "alpha" && s.cell === CELL.PUFF) puffs.push({ x: s.x, y: s.y, z: s.z, size0: s.size0, delay: s.delay, end: s.delay + s.life });
        if (pool === "add" && s.delay === 0 && s.life === FIREBALL_FALL) glows.push({ lum: 0.2126 * s.r0 + 0.7152 * s.g0 + 0.0722 * s.b0, size: s.size0, cell: s.cell });
        spawn(pool, s);
      };
      castSpell(v, "fireball", 9, 12, "player");
      puffs.sort((a, b) => a.delay - b.delay);
      expect(puffs.length).toBeGreaterThan(8);
      for (let i = 1; i < puffs.length; i++) {
        const gap = Math.hypot(puffs[i].x - puffs[i - 1].x, puffs[i].y - puffs[i - 1].y, puffs[i].z - puffs[i - 1].z);
        expect(gap, `scale ${scale}`).toBeLessThanOrEqual(RIBBON_SPACING * puffs[i].size0 + 1e-6);
      }
      for (const p of puffs) expect(p.end).toBeLessThanOrEqual(FIREBALL_FALL + RIBBON_LINGER + 1e-6);
      // The comet's glow halo is under the threshold; only its small core is over it.
      const glow = glows.find((g) => g.cell === CELL.SOFT)!;
      const core = glows.find((g) => g.cell === CELL.EMBER)!;
      expect(glow.lum).toBeLessThanOrEqual(0.9);
      expect(core.lum).toBeGreaterThan(1);
      expect(core.lum).toBeLessThan(1.4);
    }
  });

  it("zap bolts are electric blue under the threshold and stay inside the spell's radius", async () => {
    const { MODE_SEGMENT } = await import("../../particles");
    const r = spellRadius("zap");
    for (const [x, y] of [[9, 12], [4, 20], [14, 7]]) {
      const v = new VfxPool(host());
      const out: string[] = [];
      const w = { x: x - 9, z: y - 16 };
      let cores = 0;
      const spawn = v.spawn.bind(v);
      v.spawn = (pool, s) => {
        if (s.mode === MODE_SEGMENT) {
          for (const e of [-0.5, 0.5]) {
            const d = Math.hypot(s.x + s.vx * e - w.x, s.z + s.vz * e - w.z);
            if (d > r + 1e-6) out.push(d.toFixed(2));
          }
          if (pool === "add" && s.b0 > s.r0 * 1.3) {
            cores++;
            expect(0.2126 * s.r0 + 0.7152 * s.g0 + 0.0722 * s.b0).toBeLessThan(0.9);
          }
          if (pool === "add") expect(s.b0, "blue, not white").toBeGreaterThan(s.r0 * 1.3);
        }
        spawn(pool, s);
      };
      castSpell(v, "zap", x, y, "player");
      expect(cores).toBeGreaterThan(5);
      expect(out).toEqual([]);
    }
  });

  it("a fireball scorch is a warm brown leaning toward the floor, never a near-black hole", async () => {
    const { SCORCH_ALPHA, scorchColor, linearLuminance } = await import("./decals");
    const v = new VfxPool(host());
    const colors: number[] = [];
    const alphas: number[] = [];
    const add = v.decals.add.bind(v.decals);
    v.decals.add = (kind, wx, wz, r, now, o) => {
      if (kind === "scorch") {
        colors.push(o?.color ?? 0xffffff);
        alphas.push(o?.alpha ?? 1);
      }
      return add(kind, wx, wz, r, now, o);
    };
    castSpell(v, "fireball", 9, 12, "player");
    expect(colors).toEqual([scorchColor(v.floorColor())]);
    expect(alphas[0]).toBe(SCORCH_ALPHA);
    expect(SCORCH_ALPHA).toBeLessThanOrEqual(0.75);
    const hsl = { h: 0, s: 0, l: 0 };
    for (const dust of [0xc9b99c, 0xd6b25e, 0x9aa7b8, 0x6f8f4a]) {
      const c = scorchColor(dust);
      new THREE.Color(c).getHSL(hsl, THREE.SRGBColorSpace);
      expect(hsl.l, dust.toString(16)).toBeGreaterThan(0.15); // not near-black
      expect(hsl.l, dust.toString(16)).toBeLessThan(0.4); // still a burn
      expect(linearLuminance(c)).toBeLessThan(0.2);
    }
  });
});

describe("modelled projectiles", () => {
  it("the fireball is a hot core in flame petals: no cone primitive, core above the bloom threshold", async () => {
    const { buildProjectileView } = await import("./effects");
    const { projectileStyle } = await import("../../projectiles");
    for (const id of ["wizard", "baby-dragon", "firecracker"] as CardId[]) {
      const view = buildProjectileView(projectileStyle(id, "troop"));
      let cones = 0;
      let core: THREE.Mesh | null = null;
      view.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (m.geometry.type === "ConeGeometry") cones++;
        if (m.name === "core") core = m;
      });
      expect(cones, id).toBe(0);
      expect(core, id).not.toBeNull();
      const c = ((core as unknown as THREE.Mesh).material as THREE.MeshBasicMaterial).color;
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      expect(lum, id).toBeGreaterThan(1);
      // Only just over: an orange glow, not a white bloom star over its petals.
      expect(lum, id).toBeLessThan(1.3);
      expect(view.getObjectByName("petals"), id).toBeDefined();
      // The core is small next to the petals, so they read round it.
      const coreR = (core as unknown as THREE.Mesh).geometry.boundingSphere ?? ((core as unknown as THREE.Mesh).geometry.computeBoundingSphere(), (core as unknown as THREE.Mesh).geometry.boundingSphere!);
      const petals = view.getObjectByName("petals") as THREE.Mesh;
      petals.geometry.computeBoundingBox();
      const pb = petals.geometry.boundingBox!;
      expect(coreR.radius * 2, id).toBeLessThan(0.5 * Math.max(pb.max.x - pb.min.x, pb.max.y - pb.min.y));
    }
  });

  it("a shot's smoke ribbon is shed at most half a puff apart at 60 or 30 fps and on lower qualities", async () => {
    const { shedProjectileTrail } = await import("./effects");
    const { projectileStyle } = await import("../../projectiles");
    const { RIBBON_PUFF0, RIBBON_SPACING } = await import("./presets");
    expect(min(PRESETS["ribbon-puff"][0].size0)).toBeCloseTo(RIBBON_PUFF0);
    // Short-lived: the ribbon never hangs in the air after the shot lands.
    expect(Math.max(...([PRESETS["ribbon-puff"][0].life].flat() as number[]))).toBeLessThanOrEqual(0.35);
    for (const id of ["wizard", "baby-dragon", "firecracker", "cannon", "ice-wizard"] as CardId[]) {
      const style = projectileStyle(id, "troop");
      for (const scale of [1, 0.5]) {
        for (const step of [0.15, 0.3, 0.45]) {
          q.scale = scale;
          const v = new VfxPool(host());
          const puffs: Array<{ x: number; y: number; z: number; r: number }> = [];
          const emit = v.emitWorld.bind(v);
          v.emitWorld = (preset, x, y, z, opts) => {
            if (preset === "ribbon-puff") puffs.push({ x, y, z, r: opts?.radius ?? 1 });
            emit(preset, x, y, z, opts);
          };
          const b = { fx: v } as unknown as Parameters<typeof shedProjectileTrail>[0];
          const prev = new THREE.Vector3(0, 1, 0);
          for (let f = 1; f <= 4; f++) {
            shedProjectileTrail(b, style, f * step, 1, 0, prev);
            prev.set(f * step, 1, 0);
          }
          if (style.trail !== "embers" && style.trail !== "smoke" && style.trail !== "frost") continue;
          expect(puffs.length, `${id} ${step}`).toBeGreaterThan(3);
          for (let i = 1; i < puffs.length; i++) {
            const gap = Math.hypot(puffs[i].x - puffs[i - 1].x, puffs[i].y - puffs[i - 1].y, puffs[i].z - puffs[i - 1].z);
            expect(gap, `${id} step ${step} scale ${scale}`).toBeLessThanOrEqual(RIBBON_SPACING * RIBBON_PUFF0 * puffs[i].r + 1e-6);
          }
        }
      }
    }
  });

  it("arrows carry fletching in one draw; every form builds", async () => {
    const { buildProjectileView } = await import("./effects");
    const { projectileStyle } = await import("../../projectiles");
    const arrow = buildProjectileView(projectileStyle("archers", "troop"));
    let meshes = 0;
    arrow.traverse((o) => (meshes += (o as THREE.Mesh).isMesh ? 1 : 0));
    expect(meshes).toBe(1);
    for (const id of ["musketeer", "electro-wizard", "ice-wizard", "witch", "cannon", "magic-archer", "princess"] as CardId[]) {
      expect(buildProjectileView(projectileStyle(id, "troop")), id).toBeDefined();
    }
  });
});

describe("damage numbers merge and stack", () => {
  it("a second hit on the same target within 150 ms merges into one number", async () => {
    const { MERGE_WINDOW } = await import("./glyphs");
    const v = new VfxPool(host());
    v.popup(0, 1, 0, "160", 1, "#ffd23f");
    v.update(MERGE_WINDOW / 2);
    v.popup(0, 1, 0, "80", 1, "#ffd23f");
    expect(v.glyphs.live).toHaveLength(1);
    expect(v.glyphs.live[0].value).toBe(240);
    v.update(MERGE_WINDOW * 2);
    v.popup(0, 1, 0, "80", 1, "#ffd23f");
    expect(v.glyphs.live).toHaveLength(2);
  });

  it("with target ids, only hits on the same target merge (arrows on a packed group stay apart)", async () => {
    const { MERGE_WINDOW } = await import("./glyphs");
    const v = new VfxPool(host());
    // Two packed units, same spot on screen, hit on the same tick.
    v.popup(0, 1, 0, "48", 1, "#ffd23f", false, 7);
    v.popup(0.1, 1, 0, "48", 1, "#ffd23f", false, 8);
    expect(v.glyphs.live.map((p) => p.value)).toEqual([48, 48]);
    // The same target again inside the window merges, even after it moved a little.
    v.update(MERGE_WINDOW / 2);
    v.popup(0.7, 1, 0, "30", 1, "#ffd23f", false, 7);
    expect(v.glyphs.live.map((p) => [p.target, p.value]).sort()).toEqual([[7, 78], [8, 48]]);
    // Without ids (an older caller), the same spot still merges.
    const w = new VfxPool(host());
    w.popup(0, 1, 0, "10", 1, "#ffd23f");
    w.popup(0.1, 1, 0, "20", 1, "#ffd23f");
    expect(w.glyphs.live.map((p) => p.value)).toEqual([30]);
  });

  it("numbers on neighbouring targets stack instead of overlapping", async () => {
    const { stackLift } = await import("./glyphs");
    const { POPUP_LIFE, popupRise } = await import("../../popups");
    const v = new VfxPool(host());
    v.popup(0, 1, 0, "160", 1, "#ffd23f");
    v.update(0.2);
    v.popup(0.4, 1, 0, "80", 1, "#ffd23f"); // a different target, close by
    const [a, b] = v.glyphs.live;
    expect(b.lift).toBeGreaterThan(0);
    // For the rest of both lives the two never come closer than their heights allow.
    for (let t = 0; t <= POPUP_LIFE - 0.2; t += 0.02) {
      const ya = a.vy + a.lift + popupRise((t + 0.2) / POPUP_LIFE);
      const yb = b.vy + b.lift + popupRise(t / POPUP_LIFE);
      if (t + 0.2 < POPUP_LIFE - 0.15) expect(Math.abs(ya - yb)).toBeGreaterThanOrEqual(0.4 * (a.h + b.h) - 1e-6);
    }
    // Far apart on screen: no lift needed.
    expect(stackLift(v.glyphs.live, 9, 1.3, 0.8, 1.25, v.now, 1)).toBe(0);
  });
});

describe("floor dust per look", () => {
  it("Classic dust is the lane dirt; the Golden Age court's is its own sand, never violet", async () => {
    const { floorDust } = await import("./pool");
    const { LOOKS, ISLAMIC_LOOKS } = await import("../../arenaLooks");
    const hsl = { h: 0, s: 0, l: 0 };
    for (const look of [...Object.values(LOOKS), ...Object.values(ISLAMIC_LOOKS)]) {
      new THREE.Color(floorDust(look)).getHSL(hsl, THREE.SRGBColorSpace);
      expect(hsl.l, look.id).toBeLessThanOrEqual(0.67);
      expect(hsl.s, look.id).toBeLessThanOrEqual(0.43);
    }
    new THREE.Color(floorDust(ISLAMIC_LOOKS.courtyard)).getHSL(hsl, THREE.SRGBColorSpace);
    expect(hsl.h * 360).toBeGreaterThan(25); // sandy, not lavender
    expect(hsl.h * 360).toBeLessThan(60);
  });
});
