import { describe, expect, it } from "vitest";
import { DEFAULT_DECK, type CardId } from "../game/cards";
import { memoryKV } from "./kv";
import {
  DECK_SLOTS_KEY,
  SLOT_COUNT,
  SLOT_NAME_MAX,
  cleanCards,
  cleanName,
  freshSlots,
  isFullDeck,
  loadDeckSlots,
  mirrorActiveDeck,
  playableDeck,
  renameSlot,
  sanitizeSlots,
  saveDeckSlots,
  setActiveSlot,
  setSlotCards,
  withActiveDeck,
} from "./decks";

const OLD: CardId[] = ["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"];
const OTHER: CardId[] = ["wizard", "witch", "hog-rider", "balloon", "prince", "pekka", "zap", "cannon"];

function stored(kv: { data: Record<string, string> }): unknown {
  return JSON.parse(kv.data[DECK_SLOTS_KEY]);
}

describe("deck slots: migration", () => {
  it("moves the single saved deck into slot 1 (and slots 2-3 start from it)", () => {
    const kv = memoryKV();
    const s = loadDeckSlots(kv, OLD);
    expect(s.active).toBe(0);
    expect(s.slots).toHaveLength(SLOT_COUNT);
    expect(s.slots[0]).toEqual({ name: "", cards: OLD });
    expect(s.slots[1].cards).toEqual(OLD);
    expect(s.slots[2].cards).toEqual(OLD);
    // Saved, so the migration runs once.
    expect(stored(kv)).toEqual(s);
  });

  it("never replaces existing slots on a later load", () => {
    const kv = memoryKV();
    let s = loadDeckSlots(kv, OLD);
    s = setSlotCards(s, 1, OTHER);
    saveDeckSlots(s, kv);
    const again = loadDeckSlots(kv, OLD);
    expect(again.slots[1].cards).toEqual(OTHER);
    expect(again.slots[0].cards).toEqual(OLD);
  });

  it("the live saved deck wins over a stale copy in the active slot", () => {
    const kv = memoryKV();
    saveDeckSlots(setActiveSlot(setSlotCards(freshSlots(OLD), 2, OTHER), 2), kv);
    // Something edited meta.playerDeck (card info 'Use', a chest reveal…).
    const live: CardId[] = [...OTHER.slice(0, 7), "knight"];
    const s = loadDeckSlots(kv, live);
    expect(s.active).toBe(2);
    expect(s.slots[2].cards).toEqual(live);
    expect(s.slots[0].cards).toEqual(OLD);
    expect((stored(kv) as { slots: { cards: CardId[] }[] }).slots[2].cards).toEqual(live);
  });

  it("ignores a short live deck (mid-edit) instead of saving it into a slot", () => {
    const kv = memoryKV();
    saveDeckSlots(freshSlots(OLD), kv);
    const s = loadDeckSlots(kv, OLD.slice(0, 5));
    expect(s.slots[0].cards).toEqual(OLD);
  });
});

describe("deck slots: mirrorActiveDeck (saveProfile's hook)", () => {
  it("writes the saved deck into the active slot only", () => {
    const kv = memoryKV();
    saveDeckSlots(setActiveSlot(freshSlots(OLD), 1), kv);
    mirrorActiveDeck(kv, OTHER);
    const s = loadDeckSlots(kv, OTHER);
    expect(s.slots[1].cards).toEqual(OTHER);
    expect(s.slots[0].cards).toEqual(OLD);
    expect(s.slots[2].cards).toEqual(OLD);
  });

  it("migrates on first save, and skips short decks", () => {
    const kv = memoryKV();
    mirrorActiveDeck(kv, OLD.slice(0, 3));
    expect(kv.data[DECK_SLOTS_KEY]).toBeUndefined();
    mirrorActiveDeck(kv, OLD);
    expect(loadDeckSlots(kv, OLD).slots[0].cards).toEqual(OLD);
  });

  it("does not rewrite storage when nothing changed", () => {
    const kv = memoryKV();
    saveDeckSlots(freshSlots(OLD), kv);
    let writes = 0;
    const counting = { getItem: kv.getItem, setItem: (k: string, v: string) => (writes++, kv.setItem(k, v)) };
    mirrorActiveDeck(counting, OLD);
    loadDeckSlots(counting, OLD);
    expect(writes).toBe(0);
  });

  it("survives blocked storage", () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error("blocked");
      },
      setItem: (): void => {
        throw new Error("blocked");
      },
    };
    expect(() => mirrorActiveDeck(broken, OLD)).not.toThrow();
    expect(loadDeckSlots(broken, OLD).slots[0].cards).toEqual(OLD);
    expect(loadDeckSlots(null, OLD).slots[0].cards).toEqual(OLD);
  });
});

describe("deck slots: edits", () => {
  it("switches the active slot (range-checked)", () => {
    const s = freshSlots(OLD);
    expect(setActiveSlot(s, 2).active).toBe(2);
    expect(setActiveSlot(s, 3)).toBe(s);
    expect(setActiveSlot(s, -1)).toBe(s);
    expect(setActiveSlot(s, 1.5)).toBe(s);
    expect(setActiveSlot(s, 0)).toBe(s);
  });

  it("sets cards without touching other slots", () => {
    const s = setSlotCards(freshSlots(OLD), 1, OTHER);
    expect(s.slots.map((x) => x.cards)).toEqual([OLD, OTHER, OLD]);
    expect(withActiveDeck(s, OLD)).toBe(s);
    expect(withActiveDeck(setActiveSlot(s, 1), OLD).slots[1].cards).toEqual(OLD);
  });

  it("renames, trims and caps names; empty resets to the default", () => {
    let s = renameSlot(freshSlots(OLD), 0, "  Hog   cycle \n");
    expect(s.slots[0].name).toBe("Hog cycle");
    s = renameSlot(s, 1, "A very very long deck name indeed");
    expect(s.slots[1].name.length).toBe(SLOT_NAME_MAX);
    s = renameSlot(s, 0, "   ");
    expect(s.slots[0].name).toBe("");
    expect(cleanName("مجموعة الهجوم")).toBe("مجموعة الهجوم");
    expect(cleanName(42)).toBe("");
  });

  it("makes a slot playable from owned cards", () => {
    const owned = new Set<CardId>([...DEFAULT_DECK, "wizard", "zap"]);
    const s = setSlotCards(freshSlots(OLD), 1, OTHER);
    const deck = playableDeck(s, 1, owned);
    expect(deck).toHaveLength(8);
    expect(deck.slice(0, 2)).toEqual(["wizard", "zap"]);
    expect(deck.every((id) => owned.has(id))).toBe(true);
  });
});

describe("deck slots: sanitizing", () => {
  it("cleans cards: known, unique, at most 8", () => {
    expect(cleanCards(["knight", "knight", "nope", 3, "zap"])).toEqual(["knight", "zap"]);
    expect(cleanCards([...OLD, ...OTHER])).toEqual(OLD);
    expect(cleanCards("knight")).toEqual([]);
    expect(isFullDeck(OLD)).toBe(true);
    expect(isFullDeck(OLD.slice(1))).toBe(false);
    expect(isFullDeck([...OLD.slice(1), "knight"])).toBe(true);
    expect(isFullDeck([...OLD.slice(1), "archers"])).toBe(false);
  });

  it("repairs a damaged store", () => {
    expect(sanitizeSlots(null)).toBeNull();
    expect(sanitizeSlots({ slots: "x" })).toBeNull();
    const s = sanitizeSlots({ active: 7, slots: [{ name: 5, cards: OLD }, { cards: ["x"] }] })!;
    expect(s.active).toBe(0);
    expect(s.slots).toHaveLength(3);
    expect(s.slots[0].name).toBe("");
    // Empty slots borrow the first full deck.
    expect(s.slots[1].cards).toEqual(OLD);
    expect(s.slots[2].cards).toEqual(OLD);
  });

  it("reads corrupt JSON as a fresh migration", () => {
    const kv = memoryKV({ [DECK_SLOTS_KEY]: "{not json" });
    expect(loadDeckSlots(kv, OLD).slots[0].cards).toEqual(OLD);
  });
});
