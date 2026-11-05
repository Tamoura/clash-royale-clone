import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DECK } from "../game/cards";
import { cardsAvailableAt } from "./arenas";
import type { CardId } from "../game/cards";
import { ownedSet, starterOwned } from "./collection";
import {
  CHEST_TIMER_MS,
  FREE_CHEST_INTERVAL_MS,
  LEGENDARY_NEW_CARD_WEIGHT,
  LEGENDARY_PITY_CHESTS,
  LEGENDARY_PITY_KEY,
  chestsEarned,
  claimFreeChest,
  earlyTimerMs,
  emptyChestSlots,
  ensureFirstChestCard,
  firstChestCard,
  freeChestReadyAt,
  grantMatchChest,
  hasLegendary,
  isFreeChestReady,
  isLegendary,
  legendaryGuaranteed,
  legendaryPity,
  mulberry32,
  noteChestsEarned,
  openChest,
  rollChest,
  setLegendaryPity,
  type ChestRarity,
} from "./chests";
import { memoryKV } from "./kv";
import { applyMatchResult, tryOpenChest, type PlayerProfile } from "./progress";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function newProfile(): PlayerProfile {
  return {
    trophies: 0,
    gold: 100,
    gems: 0,
    owned: starterOwned(),
    shards: {},
    levels: {},
    chests: emptyChestSlots(),
    deck: [...DEFAULT_DECK],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chests", () => {
  it("grants a ready free chest into an empty slot on a win", () => {
    const rng = mulberry32(1);
    const { slots, granted, rarity } = grantMatchChest(
      emptyChestSlots(),
      0,
      1_000_000,
      rng,
      true,
      0,
    );
    expect(granted).toBe(true);
    expect(rarity).not.toBeNull();
    const filled = slots.filter(Boolean);
    expect(filled).toHaveLength(1);
    // The first chest a profile earns opens at once, whatever its rarity.
    expect(filled[0]!.readyAt).toBe(1_000_000);
  });

  it("opens with seeded rewards (gold always, deterministic)", () => {
    const a = openChest(
      { rarity: "free", readyAt: 0 },
      0,
      ownedSet(DEFAULT_DECK),
      mulberry32(42),
    );
    const b = openChest(
      { rarity: "free", readyAt: 0 },
      0,
      ownedSet(DEFAULT_DECK),
      mulberry32(42),
    );
    expect(a).toEqual(b);
    expect(a.gold).toBeGreaterThan(0);
  });

  it("can unlock a new arena-available card from a chest", () => {
    // At Goblin Stadium trophies, skeletons/zap/cannon are findable.
    const owned = ownedSet(DEFAULT_DECK);
    let foundNew = false;
    for (let seed = 0; seed < 80; seed++) {
      const r = openChest(
        { rarity: "rare", readyAt: 0 },
        100,
        owned,
        mulberry32(seed),
      );
      if (r.newCard && !owned.has(r.newCard)) {
        foundNew = true;
        break;
      }
    }
    expect(foundNew).toBe(true);
  });
});

describe("early chest timers", () => {
  it("schedules 0s, 5min, 15min, then the normal 3h / 8h", () => {
    expect(earlyTimerMs(0, "rare")).toBe(0);
    expect(earlyTimerMs(1)).toBe(5 * MIN);
    expect(earlyTimerMs(2, "rare")).toBe(15 * MIN);
    expect(earlyTimerMs(3, "free")).toBe(CHEST_TIMER_MS.free);
    expect(earlyTimerMs(3, "rare")).toBe(CHEST_TIMER_MS.rare);
    expect(CHEST_TIMER_MS.free).toBe(3 * HOUR);
    expect(CHEST_TIMER_MS.rare).toBe(8 * HOUR);
  });

  it("a new profile's first 3 ladder chests open at 0s, 5min and 15min (fake clock)", () => {
    const kv = memoryKV();
    vi.stubGlobal("localStorage", kv);
    let profile = newProfile();
    let now = Date.UTC(2026, 9, 6, 9);
    const timers: number[] = [];
    for (let match = 0; match < 4; match++) {
      const before = profile.chests.slice();
      const res = applyMatchResult(profile, "player", now, 1000 + match);
      expect(res.summary.chestGranted).toBe(true);
      const fresh = res.profile.chests.find((c, i) => c && c !== before[i])!;
      timers.push(fresh.readyAt - now);
      // What the rewards wire does on matchEnd: count the new chest.
      noteChestsEarned(1);
      // Open it as soon as it is ready, so a slot is always free.
      now = fresh.readyAt;
      const i = res.profile.chests.indexOf(fresh);
      const opened = tryOpenChest(res.profile, i, now, 7);
      expect(opened.ok).toBe(true);
      profile = opened.profile;
      now += 1000;
    }
    expect(timers.slice(0, 3)).toEqual([0, 5 * MIN, 15 * MIN]);
    expect(timers[3]).toBeGreaterThanOrEqual(3 * HOUR);
    expect(chestsEarned(kv)).toBe(4);
  });

  it("reads 0 earned (new player) when storage is missing or broken", () => {
    expect(chestsEarned(null)).toBe(0);
    expect(chestsEarned(memoryKV({ "cr-clone-chests-earned": "junk" }))).toBe(0);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(chestsEarned(throwing)).toBe(0);
    expect(() => noteChestsEarned(1, throwing)).not.toThrow();
  });
});

describe("first chest", () => {
  it("the first chest opened contains an unowned card, chosen deterministically", () => {
    const profile = { ...newProfile(), trophies: 30 };
    profile.chests[0] = { rarity: "free", readyAt: 0 };
    const opened = tryOpenChest(profile, 0, 1, 99);
    expect(opened.ok).toBe(true);
    const first = ensureFirstChestCard(opened.profile, opened.rewards!, 0);
    const card = first.rewards.newCard;
    expect(card).not.toBeNull();
    expect(starterOwned()).not.toContain(card);
    expect(first.profile.owned).toContain(card);
    // Same inputs, same card: a reload can never reroll it.
    expect(ensureFirstChestCard(opened.profile, opened.rewards!, 0).rewards.newCard).toBe(card);
  });

  it("picks from the player's arena when it has unowned cards, else the next arena", () => {
    const starter = ownedSet(starterOwned());
    // Training Camp has nothing new: the next arena's first unlock.
    expect(firstChestCard(0, starter)).toBe("skeletons");
    const at = firstChestCard(250, starter)!;
    expect(cardsAvailableAt(250)).toContain(at);
    expect(starter.has(at)).toBe(false);
  });

  it("leaves later chests and chests that already rolled a card alone", () => {
    const profile = newProfile();
    const rewards = { gold: 10, gems: 0, newCard: null, shards: {} };
    expect(ensureFirstChestCard(profile, rewards, 3).rewards.newCard).toBeNull();
    const rolled = { ...rewards, newCard: "zap" as const };
    expect(ensureFirstChestCard(profile, rolled, 0).rewards.newCard).toBe("zap");
  });
});

describe("free chest", () => {
  it("is ready for a new profile and re-arms every 4h (fake clock)", () => {
    const kv = memoryKV();
    const t0 = Date.UTC(2026, 9, 6, 8);
    expect(freeChestReadyAt(kv)).toBe(0);
    expect(isFreeChestReady(t0, kv)).toBe(true);
    expect(claimFreeChest(t0, kv)).toBe(true);
    expect(freeChestReadyAt(kv)).toBe(t0 + FREE_CHEST_INTERVAL_MS);
    // Cooling down: a second claim fails and changes nothing.
    expect(claimFreeChest(t0 + 3 * HOUR, kv)).toBe(false);
    expect(freeChestReadyAt(kv)).toBe(t0 + 4 * HOUR);
    expect(claimFreeChest(t0 + 4 * HOUR - 1, kv)).toBe(false);
    // Exactly 4h later it is back, and re-arms from the claim time.
    expect(claimFreeChest(t0 + 4 * HOUR, kv)).toBe(true);
    expect(freeChestReadyAt(kv)).toBe(t0 + 8 * HOUR);
    const late = t0 + 30 * HOUR;
    expect(claimFreeChest(late, kv)).toBe(true);
    expect(freeChestReadyAt(kv)).toBe(late + 4 * HOUR);
  });
});

describe("legendary odds", () => {
  // Bone Pit + Barbarian Bowl reached: the Digger (legendary) is findable
  // next to ordinary new cards.
  const TROPHIES = 450;
  const starter = ownedSet(starterOwned());

  function rate(chest: ChestRarity, pity: number, n: number, owned = starter): { legendary: number; newCard: number } {
    let legendary = 0;
    let newCard = 0;
    for (let seed = 1; seed <= n; seed++) {
      const r = rollChest({ rarity: chest, readyAt: 0 }, TROPHIES, owned, mulberry32(seed * 7919), pity);
      if (r.newCard) newCard++;
      if (hasLegendary(r)) legendary++;
    }
    return { legendary: legendary / n, newCard: newCard / n };
  }

  it("a legendary is a rare pull, rarer still from a Wooden chest", () => {
    const free = rate("free", 0, 4000);
    const rare = rate("rare", 0, 4000);
    expect(free.legendary).toBeGreaterThan(0);
    expect(free.legendary).toBeLessThan(0.02);
    expect(rare.legendary).toBeGreaterThan(free.legendary);
    expect(rare.legendary).toBeLessThan(0.06);
    // Ordinary new cards still come all the time.
    expect(free.newCard).toBeGreaterThan(0.35);
    expect(rare.newCard).toBeGreaterThan(0.65);
  });

  it("weights a legendary far below any other new card", () => {
    expect(LEGENDARY_NEW_CARD_WEIGHT.free).toBeLessThan(LEGENDARY_NEW_CARD_WEIGHT.rare);
    expect(LEGENDARY_NEW_CARD_WEIGHT.rare).toBeLessThan(0.5);
    // Among new cards rolled at this arena, the Digger shows up much less
    // than an even share.
    const unowned = cardsAvailableAt(TROPHIES).filter((id) => !starter.has(id));
    let digger = 0;
    let rolled = 0;
    for (let seed = 1; seed <= 4000; seed++) {
      const r = rollChest({ rarity: "rare", readyAt: 0 }, TROPHIES, starter, mulberry32(seed), 0);
      if (!r.newCard) continue;
      rolled++;
      if (r.newCard === "digger") digger++;
    }
    expect(digger / rolled).toBeLessThan((1 / unowned.length) * 0.5);
  });

  it("the guarantee lives only in the big (Rare) chest", () => {
    expect(legendaryGuaranteed("rare", LEGENDARY_PITY_CHESTS)).toBe(true);
    expect(legendaryGuaranteed("rare", LEGENDARY_PITY_CHESTS - 1)).toBe(false);
    expect(legendaryGuaranteed("free", 999)).toBe(false);
    // Rare chest with a full pity counter: a legendary every time.
    expect(rate("rare", LEGENDARY_PITY_CHESTS, 300).legendary).toBe(1);
    // Wooden chest with a full counter: still just the normal odds.
    expect(rate("free", 999, 2000).legendary).toBeLessThan(0.02);
  });

  it("the guarantee gives a new legendary when one is findable, else legendary shards", () => {
    const r = rollChest({ rarity: "rare", readyAt: 0 }, TROPHIES, starter, mulberry32(3), LEGENDARY_PITY_CHESTS);
    expect(r.newCard).toBe("digger");
    const withDigger = new Set<CardId>([...starter, "digger"]);
    const s = rollChest({ rarity: "rare", readyAt: 0 }, TROPHIES, withDigger, mulberry32(3), LEGENDARY_PITY_CHESTS);
    expect(s.newCard === null || !isLegendary(s.newCard)).toBe(true);
    expect(s.shards.digger ?? 0).toBeGreaterThan(0);
    // Below the first legendary arena there is nothing to guarantee.
    const low = rollChest({ rarity: "rare", readyAt: 0 }, 150, starter, mulberry32(3), LEGENDARY_PITY_CHESTS);
    expect(hasLegendary(low)).toBe(false);
  });

  it("legendary shard drops are scarce next to the other cards", () => {
    const owned = new Set<CardId>([...cardsAvailableAt(TROPHIES)]);
    let legendaryShards = 0;
    let epicShards = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const r = rollChest({ rarity: "rare", readyAt: 0 }, TROPHIES, owned, mulberry32(seed), 0);
      for (const [id, n] of Object.entries(r.shards) as [CardId, number][]) {
        if (isLegendary(id)) legendaryShards += n;
        else if (id === "baby-dragon") epicShards += n; // one epic, for scale
      }
    }
    expect(legendaryShards).toBeGreaterThan(0);
    expect(legendaryShards).toBeLessThan(epicShards);
  });

  it("is deterministic for a seed and pity count", () => {
    const a = rollChest({ rarity: "rare", readyAt: 0 }, 2500, starter, mulberry32(11), 4);
    const b = rollChest({ rarity: "rare", readyAt: 0 }, 2500, starter, mulberry32(11), 4);
    expect(a).toEqual(b);
  });

  it("openChest moves the stored pity counter: up without a legendary, back to 0 with one", () => {
    const kv = memoryKV();
    expect(legendaryPity(kv)).toBe(0);
    // Training Camp: no legendary can drop, so every chest counts up.
    for (let i = 0; i < LEGENDARY_PITY_CHESTS; i++) openChest({ rarity: "free", readyAt: 0 }, 0, starter, mulberry32(i), kv);
    expect(legendaryPity(kv)).toBe(LEGENDARY_PITY_CHESTS);
    // A Wooden chest at the Digger's arena does not cash the guarantee in...
    const wooden = openChest({ rarity: "free", readyAt: 0 }, TROPHIES, starter, mulberry32(5), kv);
    if (!hasLegendary(wooden)) expect(legendaryPity(kv)).toBe(LEGENDARY_PITY_CHESTS + 1);
    // ...the next Rare chest does, and the counter starts over.
    const big = openChest({ rarity: "rare", readyAt: 0 }, TROPHIES, starter, mulberry32(6), kv);
    expect(hasLegendary(big)).toBe(true);
    expect(big.newCard).toBe("digger");
    expect(legendaryPity(kv)).toBe(0);
    expect(kv.data[LEGENDARY_PITY_KEY]).toBe("0");
  });

  it("reads 0 pity when storage is missing, junk or throwing", () => {
    expect(legendaryPity(null)).toBe(0);
    expect(legendaryPity(memoryKV({ [LEGENDARY_PITY_KEY]: "junk" }))).toBe(0);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(legendaryPity(throwing)).toBe(0);
    expect(() => setLegendaryPity(3, throwing)).not.toThrow();
    expect(() => openChest({ rarity: "rare", readyAt: 0 }, TROPHIES, starter, mulberry32(1), throwing)).not.toThrow();
  });
});
