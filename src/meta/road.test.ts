import { describe, expect, it } from "vitest";
import { checkSeason } from "./achievements";
import { ARENAS } from "./arenas";
import { memoryKV } from "./kv";
import { claim, claimable, freshRoad, loadRoad, nextRoadNode, saveRoad, ROAD_KEY, type RoadState } from "./road";
import { ROAD, ROAD_GATES, roadSections } from "./roadRewards";

function claimAll(state: RoadState, reached: number): RoadState {
  for (const n of claimable(reached, state.claimed)) {
    const res = claim(state, n.at, reached);
    expect(res).not.toBeNull();
    state = res!.state;
  }
  return state;
}

describe("trophy road table", () => {
  it("has a node every 50 trophies up to 3000", () => {
    expect(ROAD).toHaveLength(60);
    ROAD.forEach((n, i) => expect(n.at).toBe((i + 1) * 50));
    expect(ROAD[ROAD.length - 1].at).toBe(3000);
  });

  it("ramps gold from 50 to 400, never down", () => {
    expect(ROAD[0].gold).toBe(50);
    expect(ROAD[ROAD.length - 1].gold).toBe(400);
    for (let i = 1; i < ROAD.length; i++) expect(ROAD[i].gold!).toBeGreaterThanOrEqual(ROAD[i - 1].gold!);
  });

  it("pays gems every 250 trophies and a rare chest at every arena gate", () => {
    for (const n of ROAD) expect(!!n.gems).toBe(n.at % 250 === 0);
    for (const a of ARENAS.filter((x) => x.trophies > 0)) {
      const gate = ROAD.find((n) => n.at === a.trophies)!;
      expect(gate.gate).toBe(a.id);
      expect(gate.chest).toBe("rare");
      expect(ROAD_GATES[a.id]).toBe(a.trophies);
    }
    expect(ROAD.filter((n) => n.gate)).toHaveLength(ARENAS.length - 1);
  });

  it("splits into arena sections covering every node once", () => {
    const sections = roadSections();
    expect(sections.reduce((s, x) => s + x.nodes.length, 0)).toBe(ROAD.length);
    for (const s of sections) for (const n of s.nodes) expect(n.at).toBeGreaterThanOrEqual(s.arena.trophies);
  });
});

describe("trophy road claims", () => {
  it("only reached nodes are claimable, low to high", () => {
    expect(claimable(49, [])).toEqual([]);
    expect(claimable(120, []).map((n) => n.at)).toEqual([50, 100]);
    expect(nextRoadNode(120)?.at).toBe(150);
    expect(nextRoadNode(3000)).toBeNull();
  });

  it("claims are idempotent", () => {
    const first = claim(freshRoad(), 100, 130)!;
    expect(first.node.at).toBe(100);
    expect(first.state.claimed).toEqual([100]);
    expect(claim(first.state, 100, 130)).toBeNull();
    expect(claim(first.state, 150, 130)).toBeNull(); // not reached
    expect(claim(first.state, 125, 130)).toBeNull(); // no such node
    expect(claimable(130, first.state.claimed).map((n) => n.at)).toEqual([50]);
  });

  it("claims survive a season trophy reset: nothing pays twice", () => {
    // Climb to 1400 and claim everything on the way.
    let road = claimAll(freshRoad(), 1400);
    expect(road.claimed).toHaveLength(28);
    // The monthly soft reset drops 1400 to 1200.
    const season = checkSeason({ key: "2026-09", best: 1400, history: [] }, "2026-10", 1400);
    expect(season.reset).toBe(true);
    expect(season.trophies).toBe(1200);
    expect(claimable(season.trophies, road.claimed)).toEqual([]);
    // Climbing back over already-paid nodes pays nothing...
    expect(claimable(1400, road.claimed)).toEqual([]);
    for (const at of [1250, 1300, 1350, 1400]) expect(claim(road, at, 1400)).toBeNull();
    // ...and only genuinely new ground does.
    expect(claimable(1450, road.claimed).map((n) => n.at)).toEqual([1450]);
    road = claimAll(road, 1450);
    expect(road.claimed).toHaveLength(29);
  });

  it("persists claims and drops junk on load", () => {
    const kv = memoryKV();
    saveRoad({ claimed: [100, 50] }, kv);
    expect(loadRoad(kv).claimed).toEqual([50, 100]);
    kv.setItem(ROAD_KEY, JSON.stringify({ claimed: [50, 50, 77, "x", 3050] }));
    expect(loadRoad(kv).claimed).toEqual([50]);
    kv.setItem(ROAD_KEY, "{not json");
    expect(loadRoad(kv)).toEqual(freshRoad());
    expect(loadRoad(null)).toEqual(freshRoad());
  });
});
