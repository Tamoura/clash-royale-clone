/**
 * The drawn deploy map IS the sim's rule. Every state below is sampled on a
 * fine grid and the map's "allowed" (zoneSd > 0, and the painted texture the
 * GPU reads) is compared with checkDeploy(...) !== "bad-spot". The two rule
 * numbers the render code copies from the sim's private buffers
 * (KING_DEPLOY_BUFFER, PRINCESS_DEPLOY_BUFFER) are also bisected straight off
 * checkDeploy; the princess one in a staged battle, since no real one lets a
 * standing princess's circle decide anything.
 *
 * If this fails after a sim change, update KING_KEEP_CLEAR /
 * PRINCESS_KEEP_CLEAR (or the shape) in src/render3d/deployZone.ts.
 */
import { describe, expect, it } from "vitest";
import { ARENA_HEIGHT, ARENA_WIDTH, opposite, type Side } from "../game/arena";
import { checkDeploy, createBattle, deployCard, openLanes, type BattleState } from "../game/battle";
import type { CardId } from "../game/cards";
import {
  FIELD_H,
  FIELD_W,
  KING_KEEP_CLEAR,
  PAST_WALL,
  PRINCESS_KEEP_CLEAR,
  paintZoneField,
  sampleField,
  troopShapeFor,
  zoneSd,
  zoneShape,
  type Hole,
  type Rect,
  type ZoneMode,
  type ZoneShape,
} from "./deployZone";

type Lanes = "none" | "left" | "right" | "both";
const HAND: CardId[] = ["knight", "cannon", "digger", "fireball"];
const FULL = { amount: 10 };
/** The drawn edge may sit this far (tiles) off the rule's edge: bilinear + 8-bit quantisation. */
const EDGE = 0.07;
const KING_MSG = "sim King buffer changed: update KING_KEEP_CLEAR in src/render3d/deployZone.ts";
const PRINCESS_MSG = "sim princess buffer changed: update PRINCESS_KEEP_CLEAR in src/render3d/deployZone.ts";

function setHands(b: BattleState, cards: CardId[] = HAND): void {
  for (const s of [b.player, b.enemy]) s.hand = { cards: [...cards], queue: [] };
}

function topUp(b: BattleState): void {
  b.player.elixir = FULL;
  b.enemy.elixir = FULL;
}

/** Remove the princess towers of `owner` in the given lanes (x < 9 is left). */
function knockDown(b: BattleState, owner: Side, lanes: Lanes): void {
  const gone = (left: boolean): boolean => lanes === "both" || (left ? lanes === "left" : lanes === "right");
  b.entities = b.entities.filter((e) => !(e.side === owner && e.kind === "princess-tower" && gone(e.x < 9)));
}

/** A battle with a Cannon per side and the viewer's chosen enemy lanes open. */
function stage(view: Side, lanes: Lanes): BattleState {
  const b = createBattle();
  setHands(b);
  topUp(b);
  expect(deployCard(b, "player", "cannon", 6, 22)).toBe(true);
  expect(deployCard(b, "enemy", "cannon", 12, 10)).toBe(true);
  setHands(b);
  topUp(b);
  knockDown(b, view === "player" ? "enemy" : "player", lanes);
  return b;
}

interface Agreement {
  checked: number;
  bad: string[];
  drawnBad: string[];
}

function agree(b: BattleState, view: Side, card: CardId, mode: ZoneMode, perTile = 20): Agreement {
  const shape = zoneShape(b, view, mode);
  const field = paintZoneField(shape);
  const bad: string[] = [];
  const drawnBad: string[] = [];
  let checked = 0;
  // Exact i / perTile coordinates (0.05 * 360 is not exactly 18).
  for (let j = 0; j <= ARENA_HEIGHT * perTile; j++) {
    const y = j / perTile;
    for (let i = 0; i <= ARENA_WIDTH * perTile; i++) {
      const x = i / perTile;
      const rule = checkDeploy(b, view, card, x, y) !== "bad-spot";
      const sd = zoneSd(shape, x, y);
      if (Math.abs(sd) < 1e-9) continue; // exactly on an edge (x = 9, y = 15...): either side is right
      checked++;
      if (sd > 0 !== rule) bad.push(`(${x.toFixed(2)},${y.toFixed(2)}) sd=${sd.toFixed(4)} rule=${rule}`);
      if (Math.abs(sd) >= EDGE) {
        const drawn = sampleField(field, x, y);
        if (drawn > 0 !== rule) drawnBad.push(`(${x.toFixed(2)},${y.toFixed(2)}) drawn=${drawn.toFixed(3)} rule=${rule}`);
      }
    }
  }
  return { checked, bad, drawnBad };
}

function expectAgree(r: Agreement, minChecked: number): void {
  expect(r.checked).toBeGreaterThan(minChecked);
  expect(r.bad.slice(0, 5), `analytic map disagrees with checkDeploy (${r.bad.length}). ${KING_MSG}`).toEqual([]);
  expect(r.drawnBad.slice(0, 5), `painted map disagrees with checkDeploy (${r.drawnBad.length}). ${KING_MSG}`).toEqual([]);
}

const VIEWS: Side[] = ["player", "enemy"];
const LANES: Lanes[] = ["none", "left", "right", "both"];
const CARDS: [CardId, ZoneMode][] = [
  ["knight", "troop"],
  ["cannon", "troop"],
  ["digger", "dig"],
];

describe("the drawn deploy map is checkDeploy's (0.05-tile grid)", () => {
  for (const view of VIEWS) {
    for (const lanes of LANES) {
      for (const [card, mode] of CARDS) {
        it(`${view} view, ${lanes} open, ${card}`, () => {
          expectAgree(agree(stage(view, lanes), view, card, mode), 200_000);
        });
      }
    }
  }

  for (const view of VIEWS) {
    it(`${view} view, left open, Mirror copying the Knight`, () => {
      const b = stage(view, "left");
      setHands(b, ["mirror", "knight", "cannon", "fireball"]);
      (view === "player" ? b.player : b.enemy).lastPlayed = "knight";
      expect(checkDeploy(b, view, "mirror", 9, view === "player" ? 24 : 8)).toBe("ok");
      expectAgree(agree(b, view, "mirror", "troop"), 200_000);
    });
  }
});

/** mulberry32: a tiny seeded generator, so the random states are the same every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("seeded random battles (0.1-tile grid)", () => {
  for (let seed = 1; seed <= 6; seed++) {
    it(`seed ${seed}`, () => {
      const rand = rng(seed * 7919);
      const view: Side = rand() < 0.5 ? "player" : "enemy";
      const b = createBattle();
      setHands(b);
      topUp(b);
      const extra = Math.floor(rand() * 3);
      for (let n = 0; n < extra; n++) {
        const side: Side = rand() < 0.5 ? "player" : "enemy";
        for (let tries = 0; tries < 50; tries++) {
          const x = 1 + rand() * 16;
          const y = side === "player" ? 18 + rand() * 13 : 1 + rand() * 13;
          if (deployCard(b, side, "cannon", x, y)) break;
        }
        setHands(b);
        topUp(b);
      }
      const owner: Side = view === "player" ? "enemy" : "player";
      const lanes = LANES[Math.floor(rand() * 4)];
      knockDown(b, owner, lanes);
      expectAgree(agree(b, view, "knight", "troop", 10), 50_000);
      expectAgree(agree(b, view, "digger", "dig", 10), 50_000);
    });
  }
});

describe("the King's keep-clear radius is the sim's", () => {
  /** Where along a ray from the King checkDeploy(knight) flips from refused to allowed. */
  function edgeAlong(b: BattleState, view: Side, kx: number, ky: number, dx: number, dy: number): number {
    let lo = 4;
    let hi = 5;
    const ok = (r: number): boolean => checkDeploy(b, view, "knight", kx + dx * r, ky + dy * r) !== "bad-spot";
    expect(ok(lo), KING_MSG).toBe(false);
    expect(ok(hi), KING_MSG).toBe(true);
    while (hi - lo > 1e-7) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  }

  for (const view of VIEWS) {
    it(`16 rays bisected in the ${view} view`, () => {
      const b = createBattle();
      setHands(b);
      topUp(b);
      // Host: the enemy's left princess falls. Guest: the mirror (the player's right one).
      if (view === "player") knockDown(b, "enemy", "left");
      else knockDown(b, "player", "right");
      for (let k = 0; k < 16; k++) {
        const th = ((125 + 5 * k) * Math.PI) / 180;
        let dx = Math.cos(th);
        let dy = Math.sin(th);
        let kx = 9;
        let ky = 2.5;
        if (view === "enemy") {
          // (x, y) -> (18 - x, 32 - y)
          kx = ARENA_WIDTH - kx;
          ky = ARENA_HEIGHT - ky;
          dx = -dx;
          dy = -dy;
        }
        const r = edgeAlong(b, view, kx, ky, dx, dy);
        expect(Math.abs(r - KING_KEEP_CLEAR), `${KING_MSG} (ray ${125 + 5 * k} deg: sim edge at ${r})`).toBeLessThan(1e-6);
      }
    });
  }
});

describe("the princess keep-clear radius is the sim's", () => {
  // No real battle lets a standing princess's circle decide anything (its
  // lane is closed, so the whole circle is refused anyway). So the pin is
  // staged: the left lane is open and the still-standing RIGHT princess is
  // moved to x = 9.5 (still the right lane for openLanes), so its circle
  // reaches into the open left pocket, away from the King's keep-clear.
  function edgeAlong(b: BattleState, view: Side, px: number, py: number, dx: number, dy: number): number {
    let lo = 2.5;
    let hi = 3.5;
    const ok = (r: number): boolean => checkDeploy(b, view, "knight", px + dx * r, py + dy * r) !== "bad-spot";
    expect(ok(lo), PRINCESS_MSG).toBe(false);
    expect(ok(hi), PRINCESS_MSG).toBe(true);
    while (hi - lo > 1e-7) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  }

  for (const view of VIEWS) {
    it(`12 rays bisected in the ${view} view`, () => {
      const b = createBattle();
      setHands(b);
      topUp(b);
      const owner = opposite(view);
      // Host: the enemy's left princess falls and its right one steps to (9.5, 9.5).
      // Guest: the mirror, (x, y) -> (18 - x, 32 - y).
      knockDown(b, owner, view === "player" ? "left" : "right");
      const standing = b.entities.find((e) => e.side === owner && e.kind === "princess-tower")!;
      const m = (x: number, y: number): [number, number] => (view === "player" ? [x, y] : [ARENA_WIDTH - x, ARENA_HEIGHT - y]);
      [standing.x, standing.y] = m(9.5, 9.5);
      expect(openLanes(b, view)).toEqual(view === "player" ? { left: true, right: false } : { left: false, right: true });
      for (let k = 0; k < 12; k++) {
        const th = ((120 + 8 * k) * Math.PI) / 180; // 120..208 degrees: into the open pocket, clear of the King
        const s = view === "player" ? 1 : -1;
        const r = edgeAlong(b, view, standing.x, standing.y, s * Math.cos(th), s * Math.sin(th));
        expect(Math.abs(r - PRINCESS_KEEP_CLEAR), `${PRINCESS_MSG} (ray ${120 + 8 * k} deg: sim edge at ${r})`).toBeLessThan(1e-6);
      }
    });
  }
});

describe("the map is mirrored exactly for the guest", () => {
  const combos: [boolean, boolean][] = [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ];
  for (const [l, r] of combos) {
    it(`host lanes (${l}, ${r}) = guest lanes (${r}, ${l}) turned 180 degrees`, () => {
      const host = troopShapeFor("player", { left: l, right: r });
      const guest = troopShapeFor("enemy", { left: r, right: l });
      // A dyadic grid keeps 18 - x and 32 - y exact.
      for (let j = 0; j <= ARENA_HEIGHT * 16; j += 3) {
        const y = j / 16;
        for (let i = 0; i <= ARENA_WIDTH * 16; i += 3) {
          const x = i / 16;
          const a = zoneSd(host, x, y);
          const g = zoneSd(guest, ARENA_WIDTH - x, ARENA_HEIGHT - y);
          if (a !== g) expect(`(${x},${y}) host ${a} guest ${g}`).toBe("equal");
        }
      }
      const hp = paintZoneField(host);
      const gp = paintZoneField(guest);
      let diff = 0;
      for (let j = 0; j < FIELD_H; j++) {
        for (let i = 0; i < FIELD_W; i++) {
          if (hp[j * FIELD_W + i] !== gp[(FIELD_H - 1 - j) * FIELD_W + (FIELD_W - 1 - i)]) diff++;
        }
      }
      expect(diff).toBe(0);
    });
  }
});

/**
 * The same map built the long way from the live battle, with none of
 * troopShapeFor's shortcuts: holes at the standing enemy towers' ACTUAL
 * positions (not towerSpots), princess holes only for towers that stand
 * (not "lane closed"), and the pocket rectangles from openLanes.
 */
function liveTroopShape(b: BattleState, view: Side): ZoneShape {
  const open = openLanes(b, view);
  const [L, R, T, B] = [-PAST_WALL, ARENA_WIDTH + PAST_WALL, -PAST_WALL, ARENA_HEIGHT + PAST_WALL];
  const host = view === "player";
  const rects: Rect[] = [host ? { x0: L, y0: 17, x1: R, y1: B } : { x0: L, y0: T, x1: R, y1: 15 }];
  const pocket = (x0: number, x1: number): Rect => (host ? { x0, y0: T, x1, y1: 15 } : { x0, y0: 17, x1, y1: B });
  if (open.left && open.right) rects.push(pocket(L, R));
  else if (open.left) rects.push(pocket(L, 9));
  else if (open.right) rects.push(pocket(9, R));
  const holes: Hole[] = [];
  for (const e of b.entities) {
    if (e.side === view || e.hp <= 0) continue;
    if (e.kind === "king-tower") holes.push({ x: e.x, y: e.y, r: KING_KEEP_CLEAR });
    if (e.kind === "princess-tower") holes.push({ x: e.x, y: e.y, r: PRINCESS_KEEP_CLEAR });
  }
  return { mode: "troop", side: view, rects, holes, digHoles: [] };
}

describe("the four precomputed lane maps are the live battle's", () => {
  // DeployOverlay paints troopShapeFor(side, lanes) once per battle and picks
  // one by lane state; here it must equal the map read off the live towers.
  for (const view of VIEWS) {
    for (const lanes of LANES) {
      it(`${view} view, ${lanes} open`, () => {
        const b = stage(view, lanes);
        const live = paintZoneField(liveTroopShape(b, view));
        const pre = paintZoneField(troopShapeFor(view, openLanes(b, view)));
        let diff = 0;
        for (let k = 0; k < live.length; k++) if (live[k] !== pre[k]) diff++;
        expect(live.length).toBe(FIELD_W * FIELD_H);
        expect(diff).toBe(0);
        expect(paintZoneField(zoneShape(b, view, "troop"))).toEqual(pre);
      });
    }
  }
});
