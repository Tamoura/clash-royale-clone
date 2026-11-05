import { describe, expect, it } from "vitest";
import { DEFAULT_DECK } from "../game/cards";
import {
  STORAGE_KEYS,
  affordableUpgrades,
  applyMatchResult,
  badgeCounts,
  tabBadges,
  loadProfile,
  newCardLevel,
  saveProfile,
  tryOpenChest,
  tryUpgradeCard,
  trophyLossAt,
  type MetaStorage,
  type PlayerProfile,
} from "./progress";
import { emptyChestSlots } from "./chests";
import { MIGRATION_GOLD_BONUS, START_GOLD } from "./economy";
import { DECK_SLOTS_KEY, freshSlots, loadDeckSlots, saveDeckSlots, setActiveSlot } from "./decks";
import { freshPass } from "./pass";
import { freshAchievements } from "./achievements";
import { rollQuests } from "./quests";

function memStorage(initial: Record<string, string> = {}): MetaStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function baseProfile(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    trophies: 0,
    gold: START_GOLD,
    gems: 0,
    owned: [...DEFAULT_DECK],
    shards: {},
    levels: {},
    chests: emptyChestSlots(),
    deck: [...DEFAULT_DECK],
    ...over,
  };
}

describe("progress", () => {
  it("migrates legacy trophies and clamps an all-card deck to starter", () => {
    const storage = memStorage({
      [STORAGE_KEYS.trophies]: "250",
      [STORAGE_KEYS.levels]: JSON.stringify({ knight: 3, pekka: 5 }),
      [STORAGE_KEYS.deck]: JSON.stringify([
        "pekka",
        "witch",
        "balloon",
        "prince",
        "hog-rider",
        "mega-knight",
        "executioner",
        "princess",
      ]),
    });
    const profile = loadProfile(storage);
    expect(profile.trophies).toBe(250);
    expect(profile.owned.sort()).toEqual([...DEFAULT_DECK].sort());
    expect(profile.deck.every((id) => profile.owned.includes(id))).toBe(true);
    expect(profile.deck).toHaveLength(8);
    expect(profile.gold).toBe(START_GOLD + MIGRATION_GOLD_BONUS);
    expect(profile.levels.knight).toBe(3);
    expect(storage.getItem(STORAGE_KEYS.migrated)).toBe("1");
  });

  it("applies win rewards: trophies, gold, and a chest", () => {
    const before = baseProfile();
    const { profile, summary } = applyMatchResult(before, "player", 5_000, 7);
    expect(profile.trophies).toBe(30);
    expect(profile.gold).toBe(START_GOLD + 50);
    expect(summary.chestGranted).toBe(true);
    expect(summary.rewardLine).toContain("Chest earned");
    expect(profile.chests.some((c) => c !== null)).toBe(true);
  });

  describe("trophy floors", () => {
    const lose = (trophies: number) => applyMatchResult(baseProfile({ trophies }), "enemy", 5_000, 7);

    it("a Training Camp loss costs nothing: 50 stays 50", () => {
      const { profile, summary } = lose(50);
      expect(profile.trophies).toBe(50);
      expect(summary.trophiesDelta).toBe(0);
      expect(Object.is(summary.trophiesDelta, -0)).toBe(false);
      expect(summary.rewardLine).toContain("unchanged");
    });

    it("never drops a kid out of an arena they reached: 110 goes to 100", () => {
      const { profile, summary } = lose(110);
      expect(profile.trophies).toBe(100);
      expect(summary.trophiesDelta).toBe(-10);
    });

    it("costs the full loss when the floor is far: 130 goes to 110", () => {
      const { profile, summary } = lose(130);
      expect(profile.trophies).toBe(110);
      expect(summary.trophiesDelta).toBe(-20);
    });

    it("an arena floor itself is safe: 100 stays 100", () => {
      expect(lose(100).profile.trophies).toBe(100);
      expect(lose(0).profile.trophies).toBe(0);
    });

    it("wins and draws are unchanged", () => {
      expect(applyMatchResult(baseProfile({ trophies: 50 }), "player", 5_000, 7).profile.trophies).toBe(80);
      expect(applyMatchResult(baseProfile({ trophies: 50 }), "draw", 5_000, 7).profile.trophies).toBe(50);
    });

    it("re-exports the economy's trophyLossAt", () => {
      expect(trophyLossAt(50)).toBe(0);
      expect(trophyLossAt(110)).toBe(10);
      expect(trophyLossAt(130)).toBe(20);
    });
  });

  it("does not invent gems from match results (kid-safe)", () => {
    const { profile, summary } = applyMatchResult(baseProfile(), "player", 1, 2);
    expect(summary.gemsDelta).toBe(0);
    expect(profile.gems).toBe(0);
  });

  it("upgrades an owned card when gold and shards suffice", () => {
    const profile = baseProfile({
      gold: 100,
      shards: { knight: 10 },
      levels: { knight: 1 },
    });
    const result = tryUpgradeCard(profile, "knight");
    expect(result.ok).toBe(true);
    expect(result.profile.levels.knight).toBe(2);
    expect(result.profile.gold).toBe(80);
    expect(result.profile.shards.knight).toBe(8);
  });

  it("rejects upgrading a locked card", () => {
    const result = tryUpgradeCard(baseProfile(), "pekka");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("locked");
  });

  it("opens a ready chest and may grant shards or a new card", () => {
    const chests = emptyChestSlots();
    chests[0] = { rarity: "free", readyAt: 0 };
    const profile = baseProfile({ chests, trophies: 100 });
    const result = tryOpenChest(profile, 0, 10, 3);
    expect(result.ok).toBe(true);
    expect(result.rewards!.gold).toBeGreaterThan(0);
    expect(result.profile.chests[0]).toBeNull();
  });

  it("starts a new card two levels below the deck average", () => {
    const levels = Object.fromEntries(DEFAULT_DECK.map((id) => [id, 9]));
    const chests = emptyChestSlots();
    chests[0] = { rarity: "rare", readyAt: 0 };
    const profile = baseProfile({ chests, trophies: 3000, levels });
    // Find a seed whose chest unlocks a card (rare chests usually do).
    let unlocked = null;
    for (let seed = 1; seed < 200 && !unlocked; seed++) {
      const r = tryOpenChest(profile, 0, 10, seed);
      if (r.rewards?.newCard) unlocked = { id: r.rewards.newCard, profile: r.profile };
    }
    expect(unlocked).not.toBeNull();
    expect(unlocked!.profile.levels[unlocked!.id]).toBe(7);
    expect(unlocked!.profile.owned).toContain(unlocked!.id);
    // The deck's own levels are untouched.
    for (const id of DEFAULT_DECK) expect(unlocked!.profile.levels[id]).toBe(9);
  });

  it("never starts a new card below 1 or above the cap", () => {
    expect(newCardLevel(DEFAULT_DECK, {})).toBe(1);
    expect(newCardLevel(DEFAULT_DECK, { knight: 3, archers: 3 })).toBe(1);
    const maxed = Object.fromEntries(DEFAULT_DECK.map((id) => [id, 11]));
    expect(newCardLevel(DEFAULT_DECK, maxed)).toBe(9);
    expect(newCardLevel([], {})).toBe(1);
  });

  it("round-trips a saved profile", () => {
    const storage = memStorage();
    const profile = baseProfile({ trophies: 120, gold: 333, gems: 2 });
    saveProfile(storage, profile);
    storage.setItem(STORAGE_KEYS.migrated, "1");
    const loaded = loadProfile(storage);
    expect(loaded.trophies).toBe(120);
    expect(loaded.gold).toBe(333);
    expect(loaded.gems).toBe(2);
    expect(loaded.owned.sort()).toEqual([...DEFAULT_DECK].sort());
  });

  it("saveProfile keeps the active deck slot in step with the saved deck", () => {
    const storage = memStorage();
    const other = ["wizard", "witch", "hog-rider", "balloon", "prince", "pekka", "zap", "cannon"] as const;
    saveDeckSlots(setActiveSlot(freshSlots(DEFAULT_DECK), 2), storage);
    saveProfile(storage, baseProfile({ deck: [...other] }));
    const slots = loadDeckSlots(storage, [...other]);
    expect(slots.slots[2].cards).toEqual(other);
    expect(slots.slots[0].cards).toEqual(DEFAULT_DECK);
  });

  it("a first-ever save migrates the old single deck into slot 1", () => {
    const storage = memStorage({ [STORAGE_KEYS.deck]: JSON.stringify(DEFAULT_DECK) });
    loadProfile(storage); // first boot: migrates and saves
    expect(storage.getItem(DECK_SLOTS_KEY)).not.toBeNull();
    const slots = loadDeckSlots(storage, []);
    expect(slots.active).toBe(0);
    expect(slots.slots[0].cards).toEqual(DEFAULT_DECK);
  });
});

describe("tab badges", () => {
  const profile = { owned: ["knight", "archers", "giant"] as const, shards: { knight: 2, archers: 1, giant: 5 }, gold: 30 };

  it("counts upgrades the player can pay for (shards and gold)", () => {
    const p = { ...profile, owned: [...profile.owned] };
    // knight L1 -> 2: 2 shards, 20 gold (yes); archers: 1 shard (no); giant: rare, 50 gold (no).
    expect(affordableUpgrades(p, {})).toEqual(["knight"]);
    expect(affordableUpgrades({ ...p, gold: 60 }, {})).toEqual(["knight", "giant"]);
    // Higher levels cost more: knight L2 needs 4 shards.
    expect(affordableUpgrades(p, { knight: 2 })).toEqual([]);
    // Max level: nothing to buy.
    expect(affordableUpgrades({ ...p, gold: 99999, shards: { knight: 999 } }, { knight: 11 })).toEqual([]);
  });

  it("counts claimable road, pass, achievement and quest rewards", () => {
    const p = { ...profile, owned: [...profile.owned], gold: 0 };
    const none = badgeCounts({ profile: p, levels: {} });
    expect(none).toEqual({ upgrades: 0, road: 0, pass: 0, achievements: 0, quests: 0 });

    const pass = { ...freshPass("2026-11"), crowns: 35, claimed: [2] };
    const ach = freshAchievements();
    ach.counters.wins = 1;
    const quests = rollQuests("2026-11-05");
    const [q1, q2] = quests.active;
    quests.progress[q1] = 1e9;
    quests.progress[q2] = 1e9;
    quests.claimed.push(q2);
    const c = badgeCounts({
      profile: p,
      levels: {},
      road: { reached: 120, claimed: [50] },
      pass,
      achievements: ach,
      quests,
    });
    expect(c.road).toBe(1); // 100 (50 already claimed)
    expect(c.pass).toBe(2); // tiers 1 and 3
    expect(c.achievements).toBeGreaterThanOrEqual(1);
    expect(c.quests).toBe(1);
    const claimedAll = { ...ach, claimed: ["first-win", ...ach.claimed] };
    expect(badgeCounts({ profile: p, levels: {}, achievements: claimedAll }).achievements).toBe(c.achievements - 1);
  });

  it("puts each count on the tab that holds it", () => {
    expect(tabBadges({ upgrades: 2, road: 1, pass: 3, achievements: 4, quests: 1 })).toEqual({
      shop: 0,
      cards: 2,
      battle: 5,
      events: 0,
      profile: 4,
    });
  });
});
