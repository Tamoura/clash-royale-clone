/**
 * Controlled card-swap balance harness (`npm run balance`).
 *
 * Swaps a candidate card into a fixed base deck in place, then runs mirrored
 * self-play (same seed, both orientations). A fair card scores near 50%.
 */
import { createBattle, type BattleState } from "../src/game/battle";
import { createBot, tickBot, type BotState } from "../src/game/bot";
import { DEFAULT_DECK, type CardId } from "../src/game/cards";
import { BATTLE_DURATION, OVERTIME_DURATION, tick } from "../src/game/sim";

const TICK = 1 / 30;
const MAX_T = BATTLE_DURATION + OVERTIME_DURATION + 2;
// Seed-pairs per candidate; each plays both orientations. `npm run balance -- 64`
const GAMES = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 16;
const CANDIDATES: CardId[] = ["giant", "hog-rider", "balloon", "royal-giant", "pekka"];

function swapIn(deck: CardId[], slot: number, card: CardId): CardId[] {
  const out = deck.slice(0, 8);
  out[slot] = card;
  return out;
}

/** Drive both sides with the enemy-facing bot by flipping sides each think. */
function thinkBoth(b: BattleState, botP: BotState, botE: BotState): void {
  tickBot(b, botE, TICK);
  // Flip sides so the same bot API can pilot the player.
  const savedEnemy = b.enemy;
  const savedPlayer = b.player;
  b.enemy = savedPlayer;
  b.player = savedEnemy;
  for (const e of b.entities) {
    if (e.side === "player") e.side = "enemy";
    else if (e.side === "enemy") e.side = "player";
  }
  tickBot(b, botP, TICK);
  for (const e of b.entities) {
    if (e.side === "player") e.side = "enemy";
    else if (e.side === "enemy") e.side = "player";
  }
  b.enemy = savedEnemy;
  b.player = savedPlayer;
}

function play(seed: number, playerDeck: CardId[], enemyDeck: CardId[]): "player" | "enemy" | "draw" {
  const b = createBattle(playerDeck, enemyDeck);
  const botP = createBot(seed);
  const botE = createBot(seed ^ 0x9e3779b9);
  while (!b.result && b.time < MAX_T) {
    tick(b, TICK);
    thinkBoth(b, botP, botE);
  }
  return b.result?.winner ?? "draw";
}

function winRate(card: CardId, slot: number): { rate: number; games: number } {
  const base = DEFAULT_DECK.slice(0, 8);
  const withCard = swapIn(base, slot, card);
  let wins = 0;
  let games = 0;
  for (let i = 0; i < GAMES; i++) {
    const seed = 1000 + i * 17;
    if (play(seed, withCard, base) === "player") wins++;
    games++;
    if (play(seed, base, withCard) === "enemy") wins++;
    games++;
  }
  return { rate: wins / games, games };
}

function main(): void {
  console.log("Balance lab — controlled card-swap (mirror check ≈ 50%)\n");
  // Swap into the deck's win-con slot so every candidate is measured as THE
  // win condition of an otherwise identical deck. (Swapping the knight slot
  // instead built two-win-con decks — and a duplicate giant for the giant.)
  const slot = DEFAULT_DECK.indexOf("giant");
  for (const card of CANDIDATES) {
    const { rate, games } = winRate(card, slot);
    const pct = (rate * 100).toFixed(1);
    const filled = Math.round(rate * 20);
    const bar = "#".repeat(filled) + "-".repeat(20 - filled);
    console.log(`${card.padEnd(14)} ${pct.padStart(5)}%  [${bar}]  n=${games}`);
  }
  // True mirror: the slot card swapped for itself — must score exactly 50%.
  const mirrorCard = DEFAULT_DECK[slot];
  const mirror = winRate(mirrorCard, slot);
  console.log(`\nmirror(${mirrorCard}) ${(mirror.rate * 100).toFixed(1)}%  (expect ~50%)`);
}

main();
