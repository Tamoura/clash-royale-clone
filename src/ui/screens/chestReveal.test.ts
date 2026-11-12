import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCtx } from "../../app/ctx";
import type { CardId } from "../../game/cards";
import type { ChestRewards } from "../../meta/chests";
import { cardDisplayName } from "../../render/cardNames";
import { FakeEvent, installFakeDom, pressKey, type FakeDocument, type FakeElement } from "../fakeDom.testkit";
import { tr as uiTr } from "../i18n";
import * as reveal from "./chestReveal";
import { COLLECT_ARM_MS, LEGENDARY_BUILD_MS, flipDelay, playChestReveal, rarityLabel, revealOrder } from "./chestReveal";
import { STRIP_ARM_MS } from "./deckSwap";

// Card art needs a real canvas, and the coins' flight needs a real wallet.
vi.mock("../cardFrame", () => ({ makeCardCanvas: () => document.createElement("canvas") }));
vi.mock("../components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components")>()),
  rewardBursts: () => Promise.resolve(),
}));

const tr = (en: string): string => en;

describe("chest reveal: the legendary moment", () => {
  it("a legendary waits face down for the build-up; other cards flip at once", () => {
    expect(flipDelay("legendary", false)).toBe(LEGENDARY_BUILD_MS);
    expect(LEGENDARY_BUILD_MS).toBeGreaterThan(1200);
    for (const r of ["common", "rare", "epic"] as const) expect(flipDelay(r, false)).toBeLessThan(LEGENDARY_BUILD_MS);
    // Reduced motion: no long build, just a beat more than a plain card.
    expect(flipDelay("legendary", true)).toBeLessThan(LEGENDARY_BUILD_MS);
    expect(flipDelay("legendary", true)).toBeGreaterThan(flipDelay("epic", true));
  });

  it("without a legendary: shards from common up, the new card last", () => {
    const order = revealOrder({
      gold: 10,
      gems: 0,
      newCard: "wizard",
      shards: { "baby-dragon": 2, knight: 6, wizard: 3, musketeer: 2 },
    });
    expect(order.map((o) => o.id)).toEqual(["knight", "musketeer", "baby-dragon", "wizard"]);
    expect(order[order.length - 1].isNew).toBe(true);
    expect(order[order.length - 1].shards).toBe(3);
  });

  it("legendary shards are the finale, after an ordinary new card", () => {
    const order = revealOrder({
      gold: 10,
      gems: 0,
      newCard: "bats",
      shards: { "mega-knight": 1, knight: 6, "baby-dragon": 2 },
    });
    expect(order.map((o) => o.id)).toEqual(["knight", "baby-dragon", "bats", "mega-knight"]);
    expect(order.map((o) => o.isNew)).toEqual([false, false, true, false]);
  });

  it("a new legendary comes last of all, after legendary shards", () => {
    const order = revealOrder({
      gold: 10,
      gems: 0,
      newCard: "digger",
      shards: { digger: 1, "magic-archer": 2, knight: 6 },
    });
    expect(order.map((o) => o.id)).toEqual(["knight", "magic-archer", "digger"]);
    expect(order[2]).toEqual({ id: "digger", isNew: true, shards: 1 });
  });

  it("names the tier", () => {
    expect(rarityLabel("legendary", tr)).toBe("Legendary");
    expect(rarityLabel("epic", tr)).toBe("Epic");
  });
});

describe("chest reveal: the deck is safe from tap-through", () => {
  const DECK: CardId[] = ["knight", "archers", "giant", "musketeer", "fireball", "mini-pekka", "arrows", "baby-dragon"];
  const LOOT: ChestRewards = { gold: 40, gems: 0, newCard: "skeletons", shards: { knight: 5, skeletons: 1 } };
  let doc: FakeDocument;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    doc = installFakeDom();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Open a chest with a new card over `deck`; `saves` records each persisted deck. */
  function open(deck: CardId[] = DECK) {
    const meta = { playerDeck: deck.slice(), profile: { levels: {}, shards: { knight: 12 }, gold: 100, gems: 0 } };
    const saves: CardId[][] = [];
    const ctx = { tr: uiTr, meta, sound: {}, persistProfile: () => saves.push(meta.playerDeck.slice()) } as unknown as AppCtx;
    let closed = false;
    void playChestReveal(ctx, { rarity: "free", rewards: LOOT }).then(() => (closed = true));
    const root = doc.querySelector(".rw-reveal")!;
    return { meta, saves, root, closed: () => closed };
  }

  /** A kid tapping the middle of the screen every quarter second, as the playtester did. */
  async function tapThrough(root: FakeElement, seen: { stage: string; buttons: number; dialogs: number }[] = []): Promise<void> {
    for (let i = 0; i < 80 && root.dataset.stage !== "summary"; i++) {
      await vi.advanceTimersByTimeAsync(250);
      seen.push({
        stage: root.dataset.stage ?? "",
        buttons: root.querySelectorAll("button").length,
        dialogs: doc.querySelectorAll(".ui-modal, [role=dialog]").filter((d) => d !== root).length,
      });
      if (root.dataset.stage === "summary") break;
      const middle = root.querySelector(".rw-card") ?? root;
      middle.dispatchEvent(new FakeEvent("pointerdown", { pointerId: 1 }));
      middle.dispatchEvent(new FakeEvent("pointerup", { pointerId: 1 }));
      middle.dispatchEvent(new FakeEvent("click"));
    }
    expect(root.dataset.stage).toBe("summary");
  }

  const summaryParts = (root: FakeElement) => {
    const summary = root.querySelector(".rw-summary")!;
    const ok = summary.querySelector(".rw-summary__ok")!;
    const add = summary.querySelector(".rw-card__add")!;
    return { summary, ok, add, offer: summary.querySelector(".rw-summary__offer")! };
  };

  it("offers no button and no dialog anywhere in the sequence, only on the summary", async () => {
    const { root } = open();
    const seen: { stage: string; buttons: number; dialogs: number }[] = [];
    await tapThrough(root, seen);
    const before = seen.filter((s) => s.stage !== "summary");
    expect(new Set(before.map((s) => s.stage))).toEqual(new Set(["chest", "open", "loot", "card"]));
    expect(before.filter((s) => s.buttons > 0 || s.dialogs > 0)).toEqual([]);
    // The new card says where adding it lives.
    const { summary, ok, add, offer } = summaryParts(root);
    expect(ok.textContent).toBe(uiTr("Collect", "استلام"));
    expect(add.textContent).toBe(uiTr("Add to deck", "أضف إلى المجموعة"));
    // Collect sits where the taps landed; the offer comes after it, below.
    expect(summary.children.indexOf(offer)).toBeGreaterThan(summary.children.indexOf(ok));
    expect(doc.activeElement).toBe(ok);
  });

  it("the new card's flip says it can be added at the end", async () => {
    const { root } = open();
    let line = "";
    for (let i = 0; i < 80 && root.dataset.stage !== "summary"; i++) {
      await vi.advanceTimersByTimeAsync(250);
      line ||= root.querySelector(".rw-card__later")?.textContent ?? "";
      root.dispatchEvent(new FakeEvent("pointerdown", { pointerId: 1 }));
      root.dispatchEvent(new FakeEvent("pointerup", { pointerId: 1 }));
    }
    expect(line).toBe(uiTr("You can add it to your deck at the end.", "يمكنك إضافتها إلى مجموعتك في النهاية."));
  });

  it("tapping on through the summary keeps the deck: Collect closes, nothing is swapped", async () => {
    const { root, meta, saves, closed } = open();
    await tapThrough(root);
    // More taps on the screen (not a button) do nothing on the summary.
    root.dispatchEvent(new FakeEvent("pointerdown", { pointerId: 1 }));
    root.dispatchEvent(new FakeEvent("pointerup", { pointerId: 1 }));
    // A quick tap on Add as the summary appears is ignored, too.
    summaryParts(root).add.click();
    expect(doc.querySelector(".rw-swap")).toBeNull();
    await vi.advanceTimersByTimeAsync(COLLECT_ARM_MS);
    summaryParts(root).ok.click();
    await vi.advanceTimersByTimeAsync(300);
    expect(closed()).toBe(true);
    expect(meta.playerDeck).toEqual(DECK);
    expect(saves).toEqual([]);
  });

  it("a fast tap-through cannot collect at once: the summary and its new-card offer stay up a moment", async () => {
    const { root, closed } = open();
    await tapThrough(root);
    const { ok, offer } = summaryParts(root);
    expect(offer.querySelector(".rw-card__add")).not.toBeNull();
    // The tap-through's next taps land on Collect, under the tap spot: ignored.
    // (tapThrough looks every 250 ms, so the summary may have been up that long.)
    expect(ok.classList.contains("is-arming")).toBe(true);
    for (let t = 0; t + 120 < COLLECT_ARM_MS - 250; t += 120) {
      ok.click();
      await vi.advanceTimersByTimeAsync(120);
      expect(closed()).toBe(false);
      expect(root.dataset.stage).toBe("summary");
    }
    // Then Collect lights up and works.
    await vi.advanceTimersByTimeAsync(COLLECT_ARM_MS);
    expect(ok.classList.contains("is-arming")).toBe(false);
    ok.click();
    await vi.advanceTimersByTimeAsync(300);
    expect(closed()).toBe(true);
  });

  it("Collect waits long enough to see the summary, not so long that it feels broken", () => {
    expect(COLLECT_ARM_MS).toBeGreaterThanOrEqual(600);
    expect(COLLECT_ARM_MS).toBeLessThanOrEqual(1500);
  });

  it("Add opens the deck strip; Keep, Esc and the backdrop all keep the deck", async () => {
    const { root, meta, saves } = open();
    await tapThrough(root);
    await vi.advanceTimersByTimeAsync(STRIP_ARM_MS);
    const { add } = summaryParts(root);
    const strip = async (): Promise<FakeElement> => {
      add.click();
      const s = doc.querySelector(".rw-swap")!;
      expect(s).not.toBeNull();
      expect(doc.activeElement?.classList.contains("rw-swap__keep")).toBe(true);
      await vi.advanceTimersByTimeAsync(STRIP_ARM_MS);
      return s;
    };

    (await strip()).querySelector(".rw-swap__keep")!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(doc.querySelector(".rw-swap")).toBeNull();

    await strip();
    pressKey(doc, "Escape");
    await vi.advanceTimersByTimeAsync(0);
    expect(doc.querySelector(".rw-swap")).toBeNull();
    expect(root.dataset.stage).toBe("summary"); // Esc closed the strip, not the reveal

    (await strip()).dispatchEvent(new FakeEvent("click"));
    await vi.advanceTimersByTimeAsync(0);
    expect(doc.querySelector(".rw-swap")).toBeNull();

    expect(meta.playerDeck).toEqual(DECK);
    expect(saves).toEqual([]);
    expect(summaryParts(root).add).toBe(add); // still offered
  });

  it("swaps out exactly the card the kid taps (not the most expensive one)", async () => {
    const { root, meta, saves } = open();
    await tapThrough(root);
    await vi.advanceTimersByTimeAsync(STRIP_ARM_MS);
    summaryParts(root).add.click();
    await vi.advanceTimersByTimeAsync(STRIP_ARM_MS);
    doc.querySelectorAll(".rw-swap__card")[1].click(); // Archers
    await vi.advanceTimersByTimeAsync(0);
    const next = ["knight", "skeletons", "giant", "musketeer", "fireball", "mini-pekka", "arrows", "baby-dragon"];
    expect(meta.playerDeck).toEqual(next);
    expect(saves).toEqual([next]);
    const name = cardDisplayName("archers");
    expect(root.querySelector(".rw-summary__offer")!.textContent).toBe(
      uiTr(`Added to your deck! ${name} is still in your cards.`, `أضيفت إلى مجموعتك! وما زالت بطاقة ${name} معك.`),
    );
  });

  it("a deck with a free slot takes the new card without anything going out", async () => {
    const { root, meta, saves } = open(DECK.slice(0, 7));
    await tapThrough(root);
    await vi.advanceTimersByTimeAsync(STRIP_ARM_MS);
    summaryParts(root).add.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(doc.querySelector(".rw-swap")).toBeNull();
    expect(meta.playerDeck).toEqual([...DECK.slice(0, 7), "skeletons"]);
    expect(saves).toHaveLength(1);
  });

  it("has no automatic pick of the outgoing card left anywhere", () => {
    expect("swapOutIndex" in reveal).toBe(false);
  });
});
