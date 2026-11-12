import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardId } from "../../game/cards";
import { cardDisplayName } from "../../render/cardNames";
import { ARABIC } from "../../render3d/theme";
import { FakeEvent, installFakeDom, pressKey, type FakeDocument, type FakeElement } from "../fakeDom.testkit";
import { tr } from "../i18n";
import { DECK_SIZE, STRIP_ARM_MS, STRIP_LOOK, addWithoutSwap, pickSwapOut, swapIntoDeck } from "./deckSwap";

// Card art needs a real canvas; the strip only needs something to hold.
vi.mock("../cardFrame", () => ({ makeCardCanvas: () => document.createElement("canvas") }));

const DECK: CardId[] = ["knight", "archers", "giant", "musketeer", "fireball", "mini-pekka", "arrows", "baby-dragon"];

describe("deck strip: the kid chooses which card leaves", () => {
  it("swaps exactly the card they tapped, and nothing else", () => {
    const next = swapIntoDeck(DECK, 3, "skeletons")!;
    expect(next).toEqual(["knight", "archers", "giant", "skeletons", "fireball", "mini-pekka", "arrows", "baby-dragon"]);
    expect(DECK[3]).toBe("musketeer"); // the old deck is untouched
    // The Giant (the most expensive card) stays unless they tap it.
    expect(next).toContain("giant");
  });

  it("is not a choice for a slot that doesn't exist or a card already in", () => {
    for (const i of [-1, 8, 1.5, Number.NaN]) expect(swapIntoDeck(DECK, i, "skeletons")).toBeNull();
    expect(swapIntoDeck(DECK, 0, "giant")).toBeNull();
  });

  it("a deck with room takes the card without anything going out", () => {
    expect(addWithoutSwap(DECK.slice(0, 7), "skeletons")).toEqual([...DECK.slice(0, 7), "skeletons"]);
    expect(addWithoutSwap(DECK, "skeletons")).toBeNull(); // full: the kid picks
    expect(addWithoutSwap(DECK.slice(0, 7), "knight")).toBeNull();
    expect(DECK).toHaveLength(DECK_SIZE);
  });

  it("'Keep my deck' is the big yellow default and takes the first focus", () => {
    expect(STRIP_LOOK.cancel).toBe("cta");
    expect(STRIP_LOOK.focus).toBe("cancel");
  });

  it("ignores the second tap of a double tap on Add", () => {
    expect(STRIP_ARM_MS).toBeGreaterThanOrEqual(300);
    expect(STRIP_ARM_MS).toBeLessThanOrEqual(800);
  });
});

describe("deck strip on the page: nothing changes until the kid taps a card", () => {
  let doc: FakeDocument;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    doc = installFakeDom();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Open the strip for Skeletons over DECK; `settled` flips once it answers. */
  function open() {
    let settled = false;
    const answer = pickSwapOut("skeletons", DECK).finally(() => (settled = true));
    const strip = doc.querySelector(".rw-swap")!;
    return {
      answer,
      settled: () => settled,
      strip,
      cards: strip.querySelectorAll(".rw-swap__card"),
      keep: strip.querySelector(".rw-swap__keep")!,
    };
  }
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it("shows the whole deck with nothing picked, and Keep my deck is the focused default", async () => {
    const s = open();
    expect(s.cards).toHaveLength(DECK.length);
    expect(s.cards.map((c) => c.textContent)).toEqual(DECK.map(cardDisplayName));
    expect(s.strip.querySelectorAll(".is-selected, [aria-pressed=\"true\"]")).toHaveLength(0);
    expect(doc.activeElement).toBe(s.keep);
    expect(s.keep.classList.contains("ui-btn--cta")).toBe(true);
    expect(s.keep.textContent).toBe(tr("Keep my deck", "أبقِ مجموعتي"));
    expect(s.strip.dir).toBe(ARABIC ? "rtl" : "");
    // No OK or Swap button: the only way to change the deck is a card.
    expect(s.strip.querySelectorAll("button").length).toBe(DECK.length + 1);
    await flush();
    expect(s.settled()).toBe(false);
  });

  it("Keep my deck answers null and closes", async () => {
    const s = open();
    s.keep.click();
    await expect(s.answer).resolves.toBeNull();
    expect(doc.querySelector(".rw-swap")).toBeNull();
  });

  it("Esc answers null", async () => {
    const s = open();
    pressKey(doc, "Escape");
    await expect(s.answer).resolves.toBeNull();
    expect(doc.querySelector(".rw-swap")).toBeNull();
  });

  it("a tap on the dim backdrop answers null, but not the double tap that opened it", async () => {
    const s = open();
    s.strip.dispatchEvent(new FakeEvent("click"));
    await flush();
    expect(s.settled()).toBe(false);
    vi.advanceTimersByTime(STRIP_ARM_MS);
    s.strip.dispatchEvent(new FakeEvent("click"));
    await expect(s.answer).resolves.toBeNull();
  });

  it("a tap inside the box (not a card) does nothing", async () => {
    const s = open();
    vi.advanceTimersByTime(STRIP_ARM_MS);
    (s.strip.querySelector(".rw-swap__body") as FakeElement).dispatchEvent(new FakeEvent("click"));
    await flush();
    expect(s.settled()).toBe(false);
  });

  it("a tapped card answers its slot, once the strip is armed", async () => {
    const s = open();
    s.cards[2].click(); // the second tap of a double tap on Add
    await flush();
    expect(s.settled()).toBe(false);
    vi.advanceTimersByTime(STRIP_ARM_MS);
    s.cards[2].click();
    await expect(s.answer).resolves.toBe(2);
    expect(doc.querySelector(".rw-swap")).toBeNull();
  });

  it("keeps Tab inside the strip", () => {
    const s = open();
    const e = pressKey(doc, "Tab");
    expect(e.defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(s.cards[0]); // from Keep (last) round to the first card
  });
});
