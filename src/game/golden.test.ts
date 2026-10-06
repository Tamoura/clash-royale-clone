/**
 * Golden match: a fixed deck pair, a seeded bot and a scripted player play
 * 5,400 ticks (three minutes at 30 Hz) while the state checksum is sampled
 * every 300 ticks. Any change to sim output — a stat, a targeting rule, a
 * float op order — moves these numbers.
 *
 * Only deliberate sim or balance packages may update the fixture below,
 * and they must say so in their commit. Anything else that trips this test
 * changed gameplay by accident (and would desync online play and replays).
 */
import { describe, expect, it } from "vitest";
import { createBattle, deployCard } from "./battle";
import { createBot, tickBot } from "./bot";
import { DEFAULT_DECK, type CardId } from "./cards";
import { tick } from "./sim";
import { stateChecksum } from "../net/checksum";

const DT = 1 / 30;
const TICKS = 5400;
const SAMPLE_EVERY = 300;

/** Swarms (Bats, Skeleton Army) exercise the spawn-offset table. */
const ENEMY_DECK: CardId[] = [
  "skeleton-army",
  "hog-rider",
  "valkyrie",
  "bats",
  "zap",
  "fireball",
  "musketeer",
  "tornado",
];

/** Player deploys, issued before the tick they name. */
const SCRIPT: ReadonlyArray<{ tick: number; cardId: CardId; x: number; y: number }> = [
  { tick: 255, cardId: "knight", x: 4, y: 22 },
  { tick: 510, cardId: "archers", x: 14, y: 23 },
  { tick: 765, cardId: "giant", x: 4, y: 24 },
  { tick: 1020, cardId: "fireball", x: 14, y: 9 },
  { tick: 1275, cardId: "musketeer", x: 4, y: 22 },
  { tick: 1530, cardId: "mini-pekka", x: 14, y: 23 },
  { tick: 1785, cardId: "arrows", x: 4, y: 9 },
  { tick: 2040, cardId: "knight", x: 14, y: 25 },
  { tick: 2295, cardId: "archers", x: 4, y: 22 },
  { tick: 2550, cardId: "giant", x: 14, y: 24 },
  { tick: 2805, cardId: "musketeer", x: 14, y: 23 },
  { tick: 3060, cardId: "baby-dragon", x: 4, y: 24 },
  { tick: 3315, cardId: "fireball", x: 14, y: 11 },
  { tick: 3570, cardId: "knight", x: 4, y: 22 },
  { tick: 3825, cardId: "mini-pekka", x: 14, y: 23 },
  { tick: 4080, cardId: "arrows", x: 4, y: 11 },
  { tick: 4335, cardId: "giant", x: 14, y: 25 },
  { tick: 4590, cardId: "archers", x: 4, y: 22 },
  { tick: 4845, cardId: "knight", x: 14, y: 23 },
  { tick: 5100, cardId: "musketeer", x: 4, y: 24 },
];

function playGolden() {
  const battle = createBattle(DEFAULT_DECK, ENEMY_DECK, {}, 1);
  const bot = createBot(12345, { thinkInterval: 1.2, pushAt: 7 });
  const checksums: number[] = [];
  let deployed = 0;
  let cursor = 0;
  for (let t = 0; t < TICKS; t++) {
    while (cursor < SCRIPT.length && SCRIPT[cursor].tick === t) {
      const d = SCRIPT[cursor++];
      if (deployCard(battle, "player", d.cardId, d.x, d.y)) deployed++;
    }
    tick(battle, DT);
    tickBot(battle, bot, DT);
    battle.events.length = 0; // a renderer would drain these each frame
    if ((t + 1) % SAMPLE_EVERY === 0) checksums.push(stateChecksum(battle));
  }
  return { checksums, result: battle.result, entities: battle.entities.length, deployed };
}

const FIXTURE = {
  checksums: [
    320397708, 1785647869, 1180133387, 3610359718, 437718205, 3068141241, 23787248, 3079907122,
    2165411312, 2657889669, 2010671658, 1952546159, 712712546, 976533762, 1931639174, 1643331491,
    2360152620, 2360152620,
  ],
  result: { winner: "enemy", playerCrowns: 0, enemyCrowns: 3 },
  entities: 27,
  deployed: 17,
};

describe("golden match", () => {
  it("replays bit-for-bit against the recorded fixture", () => {
    expect(playGolden()).toEqual(FIXTURE);
  });

  it("is reproducible run to run", () => {
    expect(playGolden()).toEqual(playGolden());
  });
});
