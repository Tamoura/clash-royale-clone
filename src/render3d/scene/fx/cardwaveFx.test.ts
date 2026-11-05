import { beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createBattle, deployCard, spawnUnits, type BattleState, type Entity } from "../../../game/battle";
import { getCard, type CardId } from "../../../game/cards";
import { createHand } from "../../../game/hand";
import { tick } from "../../../game/sim";
import { SIM_DT } from "../../anim/interp";
import { deathMotion, deathStyle } from "../../deathfx";
import { POP_DELAY, popDuration, popPose, spawnRecipe, type PopPose } from "../../spawnfx";
import type { Battle3D } from "../../scene3d";
import { TOWER_FLASH_PEAK, TOWER_FLASH_TIME, hitFlashTint } from "../views/animate";
import { burrowProgress, burrowStart, burrowsInFlight, resetBurrows, syncBurrows } from "./burrow";
import { COMET_SKY_HEIGHT, cometPosition, cometProgress, cometsInFlight, landDelayOf, resetComets, syncComets } from "./comet";
import { VfxPool } from "./pool";
import { emitPreset, type PoolKind } from "./presets";
import type { ParticleSpec } from "../../particles";

vi.mock("../../quality", () => ({ particleScale: () => 1 }));

// vitest runs in node: a do-nothing 2D canvas for the particle atlases.
beforeAll(() => {
  const ctx = (): CanvasRenderingContext2D =>
    new Proxy({} as Record<string | symbol, unknown>, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (prop === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        if (prop === "measureText") return () => ({ width: 40 });
        if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => ({ addColorStop: () => undefined });
        return () => undefined;
      },
      set(t, prop, v) {
        t[prop] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  vi.stubGlobal("document", { createElement: () => ({ width: 300, height: 150, getContext: ctx }) });
});

/** Just enough of Battle3D for the telegraph syncs: a scene and a pool. */
function fakeBattle(): Battle3D {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 18, -18, -50, 120);
  const fx = new VfxPool({ scene, camera, container: { clientWidth: 390 } });
  return { scene, fx } as unknown as Battle3D;
}

function giveHand(b: BattleState, cards: CardId[]): void {
  b.player.hand = createHand([...cards, "knight", "archers", "giant", "fireball", "musketeer", "zap", "bats", "minions"].slice(0, 8) as CardId[]);
  b.player.elixir = { amount: 10 };
}

function enemyPrincess(b: BattleState): Entity {
  return b.entities.find((e) => e.side === "enemy" && e.kind === "princess-tower" && e.x < 9)!;
}

describe("comet fall", () => {
  it("lasts the card's landDelay", () => {
    expect(landDelayOf("comet")).toBe(1.8);
    expect(landDelayOf("fireball")).toBe(0);
  });

  it("starts high in the sky beyond the target (as the camera sees it) and ends exactly on it", () => {
    const out = new THREE.Vector3();
    cometPosition(3, -4, "player", 0, out);
    expect(out.y).toBeCloseTo(COMET_SKY_HEIGHT);
    expect(out.z).toBeLessThan(-4); // the host's camera sits at +z: the rock falls away from it
    expect(out.x).toBeGreaterThan(3); // off the caster's right
    cometPosition(3, -4, "enemy", 0, out, -1); // an online guest's flipped camera
    expect(out.z).toBeGreaterThan(-4);
    expect(out.x).toBeLessThan(3);
    cometPosition(3, -4, "enemy", 1, out, -1);
    expect(out.toArray()).toEqual([3, 0, -4]);
    // It accelerates: the second half of the time covers more height.
    const mid = cometPosition(0, 0, "player", 0.5, new THREE.Vector3()).y;
    expect(COMET_SKY_HEIGHT - mid).toBeLessThan(mid);
  });

  it("touches the ground on the tick the sim lands it, when the tower takes the hit", () => {
    const b = createBattle();
    const tower = enemyPrincess(b);
    giveHand(b, ["comet"]);
    expect(deployCard(b, "player", "comet", tower.x, tower.y)).toBe(true);
    const total = landDelayOf("comet");
    let last = -1;
    let ticks = 0;
    const full = tower.hp;
    for (;;) {
      const p = b.pendingSpells[0];
      // Drawn just before the next tick (alpha 1) and just after this one (alpha 0).
      const after = cometProgress(p.ttl, total, 0);
      const before = cometProgress(p.ttl, total, 1);
      expect(after).toBeGreaterThan(last);
      expect(before).toBeGreaterThanOrEqual(after);
      last = after;
      b.events.length = 0;
      tick(b, SIM_DT);
      ticks++;
      if (b.pendingSpells.length === 0) {
        // The frame before this tick drew the rock on the ground...
        expect(before).toBeCloseTo(1, 9);
        // ...and this tick is the impact: the event and the tower's HP drop.
        expect(b.events.some((e) => e.type === "spell-land")).toBe(true);
        expect(full - tower.hp).toBeCloseTo(400, 6);
        break;
      }
      expect(after).toBeLessThan(1);
      expect(tower.hp).toBe(full);
    }
    expect(ticks).toBe(54);
  });

  it("draws one falling comet per pending spell and retires it when it lands", () => {
    const b = createBattle();
    const tower = enemyPrincess(b);
    giveHand(b, ["comet"]);
    deployCard(b, "player", "comet", tower.x, tower.y);
    const view = fakeBattle();
    syncComets(view, b, 1 / 60, 0);
    expect(cometsInFlight(view)).toBe(1);
    const fall = view.scene.getObjectByName("comet-fall")!;
    expect(fall).toBeDefined();
    expect(fall.getObjectByName("comet-body")).toBeDefined();
    for (let i = 0; i < 60 && b.pendingSpells.length; i++) {
      tick(b, SIM_DT);
      syncComets(view, b, SIM_DT, 0);
    }
    expect(cometsInFlight(view)).toBe(0);
    expect(view.scene.getObjectByName("comet-fall")).toBeUndefined();
    resetComets(view);
  });

  it("a comet still falling when the match ends leaves with it (the sim stops ticking)", () => {
    const b = createBattle();
    const tower = enemyPrincess(b);
    giveHand(b, ["comet"]);
    deployCard(b, "player", "comet", tower.x, tower.y);
    const view = fakeBattle();
    syncComets(view, b, 1 / 60, 0);
    expect(cometsInFlight(view)).toBe(1);
    b.result = { winner: "player", playerCrowns: 3, enemyCrowns: 0 };
    expect(b.pendingSpells.length).toBe(1); // still pending in the frozen state
    syncComets(view, b, 1 / 60, 0);
    expect(cometsInFlight(view)).toBe(0);
    expect(view.scene.getObjectByName("comet-fall")).toBeUndefined();
    resetComets(view);
  });
});

describe("digger tunnel", () => {
  it("runs from the digger's own King tower to the dig spot over the burrow time", () => {
    const b = createBattle();
    expect(burrowStart(b, "player")).toEqual({ x: 9, y: 29.5 });
    expect(burrowStart(b, "enemy")).toEqual({ x: 9, y: 2.5 });
    expect(burrowProgress(3, 3, 0)).toBe(0);
    expect(burrowProgress(SIM_DT, 3, 1)).toBeCloseTo(1, 9);
    expect(burrowProgress(1.5, 3, 0)).toBeCloseTo(0.5, 9);
  });

  it("shows a mound while the Digger digs, gone the moment it emerges", () => {
    const b = createBattle();
    giveHand(b, ["digger"]);
    expect(deployCard(b, "player", "digger", 3.5, 4)).toBe(true);
    const digger = b.entities.find((e) => e.cardId === "digger")!;
    expect(digger.burrowTimer).toBeGreaterThan(0);
    const view = fakeBattle();
    syncBurrows(view, b, 1 / 60, 0);
    expect(burrowsInFlight(view)).toBe(1);
    const mound = view.scene.getObjectByName("burrow-mound")!;
    const start = mound.position.clone();
    let emerged = false;
    for (let i = 0; i < 200 && !emerged; i++) {
      b.events.length = 0;
      tick(b, SIM_DT);
      emerged = b.events.some((e) => e.type === "emerge");
      syncBurrows(view, b, SIM_DT, 0);
      if (!emerged) expect(burrowsInFlight(view)).toBe(1);
    }
    expect(emerged).toBe(true);
    expect(burrowsInFlight(view)).toBe(0);
    // It travelled from the King (world z +13.5) toward the far side.
    expect(start.z).toBeGreaterThan(10);
    resetBurrows(view);
  });

  it("a mound still ploughing when the match ends is taken down", () => {
    const b = createBattle();
    giveHand(b, ["digger"]);
    deployCard(b, "player", "digger", 3.5, 4);
    const view = fakeBattle();
    syncBurrows(view, b, 1 / 60, 0);
    expect(burrowsInFlight(view)).toBe(1);
    b.result = { winner: "enemy", playerCrowns: 0, enemyCrowns: 1 };
    syncBurrows(view, b, 1 / 60, 0);
    expect(burrowsInFlight(view)).toBe(0);
    expect(view.scene.getObjectByName("burrow-mound")).toBeUndefined();
    resetBurrows(view);
  });

  it("the emerge burst throws big clods and dust that survive the lowest quality", () => {
    const burst = (name: string, q: number, count?: number): ParticleSpec[] => {
      const got: ParticleSpec[] = [];
      const sp = { spawn: (_k: PoolKind, s: ParticleSpec) => void got.push({ ...s }), rand: () => 0.5, scale: () => q };
      expect(emitPreset(sp, name, 0, 0, 0, { radius: 1.2, color: 0x8a6a44, count })).toBe(true);
      return got;
    };
    const low = burst("dirt-burst", 0.35);
    expect(low.length).toBeGreaterThanOrEqual(10); // not a handful of specks on a phone
    for (const c of low) expect(c.size0).toBeGreaterThanOrEqual(0.8);
    expect(burst("dirt-burst", 1).length).toBeGreaterThan(low.length);
    expect(burst("dirt-burst", 0.35, 10).length).toBeGreaterThanOrEqual(6); // the darker second wave
    expect(burst("dirt-dust", 0.35).length).toBeGreaterThanOrEqual(5);
  });

  it("only a layer that declares a floor keeps it; others still drop to one particle", () => {
    const emitted = (name: string, q: number, count?: number): number => {
      let n = 0;
      const sp = { spawn: () => void n++, rand: () => 0.5, scale: () => q };
      expect(emitPreset(sp, name, 0, 0, 0, { count })).toBe(true);
      return n;
    };
    // The 2-particle dust puff asked for 4 (countK 2): at the lowest quality
    // it thins to round(2 * 2 * 0.2) = 1, as before the floor existed.
    expect(emitted("dust", 0.2, 4)).toBe(1);
    expect(emitted("dust", 0.2)).toBe(1);
    expect(emitted("dust", 1, 4)).toBe(4);
    // A declared floor scales with the caller's count.
    expect(emitted("dirt-burst", 0.2)).toBe(10);
    expect(emitted("dirt-burst", 0.2, 32)).toBe(20);
  });

  it("the Digger climbs out of its hole; tunnellers skip the sky-drop", () => {
    expect(spawnRecipe("digger").kind).toBe("rise");
    const digger = getCard("digger");
    expect(digger.kind === "troop" && digger.deployAnywhere).toBe(true);
  });
});

describe("stone golem death", () => {
  it("golems crumble into stone and their baked bodies shatter", () => {
    expect(deathStyle("stone-golem").kind).toBe("crumble");
    expect(deathStyle("pebble-golem").kind).toBe("crumble");
    expect(deathStyle("stone-golem").scale).toBeGreaterThan(deathStyle("pebble-golem").scale);
    expect(deathMotion("stone-golem", { flying: false, hasFace: false })).toBe("shatter");
    expect(deathMotion("pebble-golem", { flying: false, hasFace: false })).toBe("shatter");
  });

  it("pebbles pop out: hidden while the golem crumbles, then a hop from its middle that lands", () => {
    const b = createBattle();
    const [golem] = spawnUnits(b, "player", "stone-golem", 9, 20);
    golem.hp = 0;
    tick(b, SIM_DT);
    expect(b.entities.filter((e) => e.cardId === "pebble-golem")).toHaveLength(2);
    const pose: PopPose = { visible: true, y: 0, sx: 1, sy: 1, sz: 1, f: 0 };
    popPose(0, pose);
    expect(pose.visible).toBe(false);
    let peak = 0;
    let lastF = 0;
    for (let t = POP_DELAY; t <= popDuration(); t += 1 / 120) {
      popPose(t, pose);
      expect(pose.visible).toBe(true);
      expect(pose.f).toBeGreaterThanOrEqual(lastF);
      lastF = pose.f;
      peak = Math.max(peak, pose.y);
    }
    popPose(popDuration(), pose);
    expect(pose.f).toBe(1);
    expect(pose.y).toBe(0);
    expect(peak).toBeGreaterThan(1);
    // Every pebble has landed before its deploy freeze ends.
    expect(popDuration()).toBeLessThan(1);
  });
});

describe("tower hit flash", () => {
  it("towers throb a soft warm tint, never the full-white block", () => {
    const out = [0, 0, 0];
    let peak = 0;
    for (let left = TOWER_FLASH_TIME; left >= 0; left -= 1 / 240) {
      hitFlashTint(true, left, true, out);
      for (const c of out) expect(c).toBeLessThanOrEqual(TOWER_FLASH_PEAK + 1e-9);
      peak = Math.max(peak, out[0]);
    }
    expect(peak).toBeGreaterThan(TOWER_FLASH_PEAK * 0.8); // still visible
    hitFlashTint(true, 0, false, out);
    expect(Math.max(...out)).toBeLessThan(0.02); // and gone at the end
  });

  it("troops keep their one-frame white snap and warm fade", () => {
    const out = [0, 0, 0];
    expect(hitFlashTint(false, 0.12, true, out)).toEqual([1, 1, 1]);
    hitFlashTint(false, 0.06, false, out);
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[2]).toBeLessThan(out[0]);
  });
});
