import { describe, expect, it } from "vitest";
import { getCard } from "../game/cards";
import { createBattle, deployCard } from "../game/battle";
import type { Side } from "../game/arena";
import { deploysAnywhere } from "./scene3d";
import {
  FIELD_H,
  FIELD_W,
  KING_KEEP_CLEAR,
  LABEL_BAND_MARGIN,
  digKey,
  laneAnchor,
  laneLabelBand,
  paintZoneField,
  ruinSpot,
  troopKey,
  troopShapeFor,
  zoneModeFor,
  zoneSd,
} from "./deployZone";

describe("deploy overlay for a dig-anywhere card", () => {
  it("only the Digger (deployAnywhere troops) lifts the enemy-half shade", () => {
    expect(deploysAnywhere(getCard("digger"))).toBe(true);
    expect(deploysAnywhere(getCard("knight"))).toBe(false);
    expect(deploysAnywhere(getCard("cannon"))).toBe(false);
    expect(deploysAnywhere(getCard("comet"))).toBe(false);
    expect(deploysAnywhere(null)).toBe(false);
  });
});

describe("which map a held card shows", () => {
  it("troops and buildings the lane map, the Digger the dig map, spells none", () => {
    expect(zoneModeFor(getCard("digger"))).toBe("dig");
    expect(zoneModeFor(getCard("knight"))).toBe("troop");
    expect(zoneModeFor(getCard("cannon"))).toBe("troop");
    expect(zoneModeFor(getCard("comet"))).toBeNull();
    expect(zoneModeFor(getCard("fireball"))).toBeNull();
    expect(zoneModeFor(null)).toBeNull();
  });
});

describe("map keys", () => {
  it("names the 8 troop maps apart", () => {
    const keys = new Set<number>();
    for (const side of ["player", "enemy"] as Side[]) {
      for (const left of [false, true]) for (const right of [false, true]) keys.add(troopKey(side, { left, right }));
    }
    expect(keys.size).toBe(8);
  });

  it("changes the dig key when a building goes down", () => {
    const b = createBattle();
    b.player.elixir = { amount: 10 };
    b.player.hand = { cards: ["cannon", "knight", "digger", "fireball"], queue: [] };
    const before = digKey(b);
    expect(deployCard(b, "player", "cannon", 6, 22)).toBe(true);
    expect(digKey(b)).not.toBe(before);
    b.entities = b.entities.filter((e) => e.kind !== "building");
    expect(digKey(b)).toBe(before);
    b.entities = b.entities.filter((e) => !(e.kind === "princess-tower" && e.side === "enemy" && e.x < 9));
    expect(digKey(b)).not.toBe(before);
  });
});

describe("painting", () => {
  it("paints a lane map in well under 30 ms", () => {
    const out = new Uint8Array(FIELD_W * FIELD_H);
    const shape = troopShapeFor("player", { left: true, right: false });
    paintZoneField(shape, out); // warm the JIT
    const t0 = performance.now();
    for (let n = 0; n < 5; n++) paintZoneField(shape, out);
    expect((performance.now() - t0) / 5).toBeLessThan(30);
  });
});

describe("lane spots", () => {
  it("puts the ruin and the label in the viewer's enemy half", () => {
    expect(ruinSpot("player", "left")).toEqual({ x: 3.5, y: 6.5 });
    expect(ruinSpot("player", "right")).toEqual({ x: 14.5, y: 6.5 });
    expect(ruinSpot("enemy", "left")).toEqual({ x: 3.5, y: 25.5 });
    expect(laneAnchor("player", "left")).toEqual({ x: 4.5, y: 11 });
    expect(laneAnchor("enemy", "right")).toEqual({ x: 13.5, y: 21 });
  });

  it("gives the label a band between the King's keep-clear and the river, in both views", () => {
    const host = laneLabelBand("player");
    expect(host.far).toBeCloseTo(2.5 + KING_KEEP_CLEAR + LABEL_BAND_MARGIN.king, 9); // 7.2
    expect(host.near).toBeCloseTo(15 - LABEL_BAND_MARGIN.river, 9); // 14.7
    const guest = laneLabelBand("enemy");
    expect(guest.far).toBeCloseTo(32 - host.far, 9);
    expect(guest.near).toBeCloseTo(32 - host.near, 9);
    // The whole band is allowed ground in an open lane, clear of the King's bite even at the seam.
    for (const side of ["player", "enemy"] as Side[]) {
      const band = laneLabelBand(side);
      const shape = troopShapeFor(side, { left: true, right: true });
      for (let x = 0.2; x <= 17.8; x += 0.2) {
        for (const y of [band.far, (band.far + band.near) / 2, band.near]) {
          expect(zoneSd(shape, x, y), `${side} (${x.toFixed(1)}, ${y})`).toBeGreaterThan(0.15);
        }
      }
      // The anchor sits inside the band.
      const a = laneAnchor(side, "left");
      expect(Math.min(band.far, band.near) < a.y && a.y < Math.max(band.far, band.near)).toBe(true);
    }
  });
});
