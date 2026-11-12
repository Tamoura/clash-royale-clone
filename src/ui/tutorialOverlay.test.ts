import { describe, expect, it, vi } from "vitest";
import { getCard, type CardId } from "../game/cards";
import { TUTORIAL_CHALLENGE } from "../game/challenges";
import { TUTORIAL_STEPS } from "../game/tutorial";
import { NUDGE_MS, cardAt, controlsTop, nudgeCopy } from "./tutorialOverlay";

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  width,
  height,
});

describe("controlsTop: where a bottom-docked coach bubble must end", () => {
  const span = { left: 15, right: 375 }; // a 360 px bubble centred at 390 wide

  it("is the top of the highest control in the bubble's columns, not the hand's", () => {
    const hud = rect(0, 690, 390, 154); // the hand tray
    const king = rect(332, 609, 46, 46); // floats above the tray
    const next = rect(12, 615, 44, 60);
    const emote = rect(334, 560, 44, 44);
    expect(controlsTop([hud, king, next, emote], span, 844)).toBe(560);
    expect(controlsTop([hud, king, next], span, 844)).toBe(609);
    expect(controlsTop([hud], span, 844)).toBe(690);
  });

  it("ignores hidden controls and controls beside the bubble (wide side panels)", () => {
    const hidden = rect(200, 100, 0, 0);
    const sidePanel = rect(980, 300, 260, 400); // right of a centred board
    expect(controlsTop([hidden, sidePanel], { left: 460, right: 820 }, 800)).toBe(800);
    // Touching edges do not overlap.
    expect(controlsTop([rect(820, 500, 40, 40)], { left: 460, right: 820 }, 800)).toBe(800);
  });

  it("never goes above the screen", () => {
    expect(controlsTop([rect(0, -20, 390, 40)], span, 844)).toBe(0);
  });
});

// ---- The wrong card -----------------------------------------------------------------

/** The edition's card names: Classic from the cards, Golden Age from the Arabic table. */
async function goldenAgeNames(): Promise<(id: CardId) => string> {
  vi.resetModules();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k === "cr-clone-arena-theme" ? "arabic" : null),
    setItem: () => {},
    removeItem: () => {},
  });
  try {
    return (await import("../render/cardNames")).cardDisplayName;
  } finally {
    vi.unstubAllGlobals();
  }
}
const classicName = (id: CardId): string => getCard(id).name;

/** The lesson each step teaches with a card (its glowing target). */
const TARGETS: Record<string, CardId> = { deploy: "knight", defend: "musketeer", spell: "fireball", push: "giant" };

/** The first card of the tutorial deck a line mentions, by position. */
function firstCardIn(text: string, name: (id: CardId) => string): CardId | null {
  let best: { id: CardId; at: number } | null = null;
  for (const id of TUTORIAL_CHALLENGE.deck) {
    const at = text.toLowerCase().indexOf(name(id).toLowerCase());
    if (at >= 0 && (!best || at < best.at)) best = { id, at };
  }
  return best?.id ?? null;
}

describe("tutorial: the wrong card gets a nudge, not silence", () => {
  const hand = [
    { id: "archers", rect: { left: 60, top: 700, right: 130, bottom: 790 } },
    { id: "mini-pekka", rect: { left: 140, top: 700, right: 210, bottom: 790 } },
    { id: "fireball", rect: { left: 220, top: 700, right: 290, bottom: 790 } },
  ];

  it("finds the card under the finger", () => {
    expect(cardAt(hand, 95, 750)).toBe("archers");
    expect(cardAt(hand, 255, 701)).toBe("fireball");
    expect(cardAt(hand, 135, 750)).toBeNull(); // the gap between cards
    expect(cardAt(hand, 95, 500)).toBeNull(); // the arena
  });

  it("names the glowing card in both languages when another card is pressed", () => {
    const [en, ar] = nudgeCopy({}, "fireball", "archers", classicName)!;
    expect(en).toBe("Not that one. Use the glowing Fireball card!");
    expect(ar).toContain("Fireball"); // the name comes from the edition's own names
    const [, arGolden] = nudgeCopy({}, "fireball", "archers", () => "قذيفة نفط")!;
    expect(arGolden).toBe("ليست هذه. استخدم بطاقة قذيفة نفط المضيئة!");
  });

  it("a press anywhere else on the dim screen points at the card too", () => {
    expect(nudgeCopy({}, "musketeer", null, classicName)![0]).toBe("Drag the glowing Musketeer card onto the glowing spot!");
  });

  it("the King lesson points at the King's power", () => {
    expect(nudgeCopy({ anchor: "ability" }, null, "giant", classicName)![0]).toMatch(/King power/);
    expect(nudgeCopy({ anchor: "ability" }, null, null, classicName)![0]).toMatch(/King power/);
  });

  it("says nothing when there is nothing to point at (or the right card)", () => {
    expect(nudgeCopy({}, null, "archers", classicName)).toBeNull();
    expect(nudgeCopy({ anchor: "elixir" }, null, null, classicName)).toBeNull();
    expect(nudgeCopy({}, "fireball", "fireball", classicName)).toBeNull();
  });

  it("the nudge line stays up long enough to read, then the lesson's line returns", () => {
    expect(NUDGE_MS).toBeGreaterThanOrEqual(2000);
    expect(NUDGE_MS).toBeLessThanOrEqual(4000);
  });
});

describe("tutorial: a lesson never opens with the name of a different card", () => {
  it("every card lesson is covered", () => {
    for (const id of Object.keys(TARGETS)) {
      const step = TUTORIAL_STEPS.find((s) => s.id === id);
      expect(step?.target, id).toBeTypeOf("function");
    }
    const withTargets = TUTORIAL_STEPS.filter((s) => s.target).map((s) => s.id);
    expect(withTargets.sort()).toEqual(Object.keys(TARGETS).sort());
  });

  it("Classic: the first card a lesson names is the card to play", () => {
    for (const [id, card] of Object.entries(TARGETS)) {
      const text = TUTORIAL_STEPS.find((s) => s.id === id)!.text[0];
      expect(firstCardIn(text, classicName), `${id}: ${text}`).toBe(card);
    }
  });

  it("Golden Age: the first card a lesson names is the card to play, by its Golden Age name", async () => {
    const golden = await goldenAgeNames();
    expect(golden("fireball")).not.toBe(classicName("fireball")); // really the Golden Age names
    for (const [id, card] of Object.entries(TARGETS)) {
      const text = TUTORIAL_STEPS.find((s) => s.id === id)!.text[1];
      expect(firstCardIn(text, golden), `${id}: ${text}`).toBe(card);
    }
  });

  it("the Fireball lesson no longer says 'Archers'", async () => {
    const golden = await goldenAgeNames();
    const spell = TUTORIAL_STEPS.find((s) => s.id === "spell")!;
    expect(spell.text[0]).not.toMatch(/archers/i);
    expect(spell.text[1]).not.toContain(golden("archers"));
  });
});
