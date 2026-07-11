import { describe, expect, it } from "vitest";
import { DEFAULT_DECK } from "../game/cards";
import {
  STORAGE_KEYS,
  applyMatchResult,
  loadProfile,
  saveProfile,
  tryOpenChest,
  tryUpgradeCard,
  type MetaStorage,
  type PlayerProfile,
} from "./progress";
import { emptyChestSlots } from "./chests";
import { MIGRATION_GOLD_BONUS, START_GOLD } from "./economy";

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
});
