/**
 * Balance lab (`npm run lab -- <mode> ...`): bot-vs-bot self-play with
 * optional stat tweaks, printing one JSON line per result.
 *
 *   random <games> [seedOffset]       per-card win rate across random decks;
 *                                     a card counts only for the side whose
 *                                     deck holds it alone (shared cards cancel)
 *   slot <slotCard> <n> <cand,cand>   swap each candidate into DEFAULT_DECK's
 *                                     <slotCard> slot; both orientations
 *   mirror <n>                        DEFAULT_DECK mirror: pacing numbers
 *                                     (length, overtime, 0-0, tiebreaks, crowns)
 *   towers tower <troop> <n>          a tower troop vs the Princess
 *   towers ability <id|none> <n> [vs] a King's ability vs another (default none)
 *
 * Every game is Normal bot vs Normal bot (one bot pilots the player side),
 * both orientations per seed. LEVEL=<n> sets every card's level (default 1).
 * TWEAKS is JSON applied before the run, e.g.
 *   TWEAKS='{"cards":{"arrows":{"damage":300}},"unit":{"royal-giant":{"maxHp":3100}},
 *            "towers":{"princess":{"damage":100}},"abil":{"restore":{"chargeSeconds":75}}}'
 * Results are deterministic per seed; split a long random run across
 * processes with different seedOffsets and merge the JSON.
 */
import { createBattle, type CardLevels } from "../src/game/battle";
import { createBot, tickBot } from "../src/game/bot";
import { CARDS, DECK, DEFAULT_DECK, isDeckable, type CardId } from "../src/game/cards";
import { TOWER_TROOPS, type TowerTroopId } from "../src/game/towers";
import { ABILITIES, type AbilityId } from "../src/game/abilities";
import { BATTLE_DURATION, OVERTIME_DURATION, tick } from "../src/game/sim";

type Tweaks = {
  cards?: Record<string, object>;
  unit?: Record<string, object>;
  towers?: Record<string, object>;
  abil?: Record<string, object>;
};

const tweaks = JSON.parse(process.env.TWEAKS ?? "{}") as Tweaks;
for (const [id, o] of Object.entries(tweaks.cards ?? {})) Object.assign(CARDS[id as CardId], o);
for (const [id, o] of Object.entries(tweaks.unit ?? {})) {
  const c = CARDS[id as CardId];
  if (c.kind !== "spell") Object.assign(c.unit, o);
}
for (const [id, o] of Object.entries(tweaks.towers ?? {})) Object.assign(TOWER_TROOPS[id as TowerTroopId], o);
for (const [id, o] of Object.entries(tweaks.abil ?? {})) Object.assign(ABILITIES[id as AbilityId], o);

const TICK = 1 / 30;
const MAX_T = BATTLE_DURATION + OVERTIME_DURATION + 2;
const LEVEL = Number(process.env.LEVEL ?? 1);
const POOL: CardId[] = DECK.filter(isDeckable);

interface Game {
  winner: "player" | "enemy" | "draw";
  time: number;
  overtime: boolean;
  playerCrowns: number;
  enemyCrowns: number;
  /** Decided on tower HP after overtime (crowns level, not a draw). */
  tiebreak: boolean;
}

interface Setup {
  towers?: { player?: TowerTroopId; enemy?: TowerTroopId };
  abilities?: { player?: AbilityId | null; enemy?: AbilityId | null };
}

function levels(): CardLevels {
  const out: CardLevels = {};
  if (LEVEL !== 1) for (const id of DECK) out[id] = LEVEL;
  return out;
}

/** One Normal-vs-Normal match: the classic profile on each side. */
function play(seed: number, playerDeck: CardId[], enemyDeck: CardId[], setup: Setup = {}): Game {
  const lv = levels();
  const b = createBattle(playerDeck, enemyDeck, { player: lv, enemy: lv }, 1, setup.towers ?? {}, setup.abilities ?? {});
  const botP = createBot(seed, { side: "player" });
  const botE = createBot(seed ^ 0x9e3779b9);
  while (!b.result && b.time < MAX_T) {
    tick(b, TICK);
    tickBot(b, botE, TICK);
    tickBot(b, botP, TICK);
    b.events.length = 0;
  }
  const r = b.result;
  return {
    winner: r?.winner ?? "draw",
    time: b.time,
    overtime: b.overtime,
    playerCrowns: b.player.crowns,
    enemyCrowns: b.enemy.crowns,
    tiebreak: !!r && r.winner !== "draw" && b.player.crowns === b.enemy.crowns,
  };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDeck(r: () => number): CardId[] {
  const p = POOL.slice();
  const out: CardId[] = [];
  while (out.length < 8) out.push(p.splice(Math.floor(r() * p.length), 1)[0]);
  return out;
}

/** Wins for `side`, a draw counting half. */
function score(g: Game, side: "player" | "enemy"): number {
  return g.winner === side ? 1 : g.winner === "draw" ? 0.5 : 0;
}

function mirror(n: number): void {
  let time = 0;
  let ot = 0;
  let zero = 0;
  let three = 0;
  let tb = 0;
  let anyCrown = 0;
  let draws = 0;
  for (let i = 0; i < n; i++) {
    const g = play(1000 + i * 17, DEFAULT_DECK, DEFAULT_DECK);
    time += g.time;
    if (g.overtime) ot++;
    if (g.playerCrowns + g.enemyCrowns === 0) zero++;
    if (g.playerCrowns === 3 || g.enemyCrowns === 3) three++;
    if (g.tiebreak) tb++;
    if (g.playerCrowns + g.enemyCrowns > 0) anyCrown++;
    if (g.winner === "draw") draws++;
  }
  console.log(
    JSON.stringify({
      mode: "mirror",
      level: LEVEL,
      games: n,
      meanSeconds: +(time / n).toFixed(1),
      overtime: +(ot / n).toFixed(3),
      zeroZero: +(zero / n).toFixed(3),
      tiebreak: +(tb / n).toFixed(3),
      threeCrown: +(three / n).toFixed(3),
      anyCrown: +(anyCrown / n).toFixed(3),
      draws,
    }),
  );
}

function slot(slotCard: CardId, n: number, cands: CardId[]): void {
  const base = DEFAULT_DECK.slice(0, 8);
  const at = base.indexOf(slotCard);
  if (at < 0) throw new Error(`${slotCard} is not in DEFAULT_DECK`);
  for (const cand of cands) {
    if (cand !== slotCard && base.includes(cand)) continue; // a duplicate deck is illegal
    const deck = base.slice();
    deck[at] = cand;
    let w = 0;
    let ot = 0;
    for (let i = 0; i < n; i++) {
      const seed = 1000 + i * 17;
      const a = play(seed, deck, base);
      const b = play(seed, base, deck);
      w += score(a, "player") + score(b, "enemy");
      if (a.overtime) ot++;
      if (b.overtime) ot++;
    }
    console.log(JSON.stringify({ mode: "slot", slot: slotCard, cand, games: 2 * n, rate: +(w / (2 * n)).toFixed(3), overtime: +(ot / (2 * n)).toFixed(3) }));
  }
}

function random(games: number, offset: number): void {
  const stat: Record<string, { w: number; g: number }> = {};
  for (let i = 0; i < games; i++) {
    const r = mulberry(777 + offset * 100003 + i * 7919);
    const A = randomDeck(r);
    const B = randomDeck(r);
    const seed = 5000 + offset * 100003 + i * 31;
    for (const [pd, ed] of [
      [A, B],
      [B, A],
    ] as const) {
      const g = play(seed, pd, ed);
      for (const [deck, other, side] of [
        [pd, ed, "player"],
        [ed, pd, "enemy"],
      ] as const) {
        for (const c of deck) {
          if (other.includes(c)) continue; // shared cards cancel out
          const s = (stat[c] ??= { w: 0, g: 0 });
          s.g++;
          s.w += score(g, side);
        }
      }
    }
  }
  console.log(JSON.stringify({ mode: "random", offset, games: games * 2, stat }));
}

/** A tower troop (vs the Princess) or a King's ability (vs `vs`), both orientations. */
function towers(kind: string, x: string, n: number, vs: string): void {
  let w = 0;
  let g = 0;
  for (let i = 0; i < n; i++) {
    const r = mulberry(99 + i * 7919);
    const deck = i % 2 ? randomDeck(r) : DEFAULT_DECK;
    for (const side of ["player", "enemy"] as const) {
      const other = side === "player" ? "enemy" : "player";
      const setup: Setup = {};
      if (kind === "tower") setup.towers = { [side]: x as TowerTroopId };
      else {
        const pick = (v: string): AbilityId | null => (v === "none" ? null : (v as AbilityId));
        setup.abilities = { [side]: pick(x), [other]: pick(vs) };
      }
      const game = play(1000 + i * 17, deck, deck, setup);
      w += score(game, side);
      g++;
    }
  }
  console.log(JSON.stringify({ mode: "towers", kind, x, vs: kind === "tower" ? "princess" : vs, games: g, rate: +(w / g).toFixed(3) }));
}

const args = process.argv.slice(2).filter((a) => a !== "--");
const mode = args[0];
if (mode === "mirror") mirror(Number(args[1] ?? 64));
else if (mode === "slot") slot(args[1] as CardId, Number(args[2] ?? 32), (args[3] ?? "").split(",").filter(Boolean) as CardId[]);
else if (mode === "random") random(Number(args[1] ?? 100), Number(args[2] ?? 0));
else if (mode === "towers") towers(args[1], args[2], Number(args[3] ?? 48), args[4] ?? "none");
else {
  console.error("usage: npm run lab -- random <games> [offset] | slot <card> <n> <cands> | mirror <n> | towers tower|ability <x> <n> [vs]");
  process.exit(1);
}
