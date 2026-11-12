import { describe, expect, it, vi } from "vitest";
import { createBattle } from "../game/battle";
import { getCard, type CardId } from "../game/cards";
import { TUTORIAL_CHALLENGE, applyWaves } from "../game/challenges";
import { tick } from "../game/sim";
import { TUTORIAL_KEY, TUTORIAL_STEPS, Tutorial, prepareTutorialBattle, tutorialChallenge } from "../game/tutorial";
import {
  NUDGE_BURST_MS,
  NUDGE_MS,
  cardAt,
  clearNudge,
  controlsTop,
  newNudge,
  nudgeCopy,
  nudgeLine,
  overlayPress,
  pressNudge,
  releaseNudge,
} from "./tutorialOverlay";

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

// ---- The press wiring ---------------------------------------------------------------

/**
 * The tutorial battle resumed at lesson `from`, run (no one playing) until
 * the lesson holds the clock, as main.ts's loop does.
 */
function heldLesson(from: number): { t: Tutorial; b: ReturnType<typeof createBattle> } {
  const store = new Map<string, string>([[TUTORIAL_KEY, String(from)]]);
  const t = new Tutorial({
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  });
  const ch = tutorialChallenge(from);
  const b = createBattle(ch.deck, ch.deck, {}, 1, { player: "princess", enemy: "princess" }, { player: "rally", enemy: "salvo" });
  prepareTutorialBattle(b, ch);
  t.enter(b);
  const cursor = { next: 0 };
  for (let i = 0; i < 30 * 60 && !t.holds(b); i++) {
    tick(b, 1 / 30);
    applyWaves(b, ch, cursor);
    for (const ev of b.events.splice(0)) t.feed(ev, b);
    t.feed({ type: "frame" }, b);
  }
  expect(t.holds(b)).toBe(true);
  return { t, b };
}

describe("tutorial: a press on the dim screen during a lesson", () => {
  const lesson = { live: true, onSkip: false, tapStep: false };

  it("gets a nudge, not silence (a card that is not the lesson's lies under the dim)", () => {
    expect(overlayPress({ ...lesson, onDim: true })).toBe("nudge");
  });

  it("continues a callout, and leaves Skip, the bubble and a finished battle alone", () => {
    expect(overlayPress({ ...lesson, tapStep: true, onDim: true })).toBe("continue");
    expect(overlayPress({ ...lesson, onSkip: true, onDim: false })).toBe("none");
    expect(overlayPress({ ...lesson, onDim: false })).toBe("none"); // the coach's bubble
    expect(overlayPress({ ...lesson, live: false, onDim: true })).toBe("none");
  });

  it("in the Fireball lesson, pressing Archers names the Fireball and keeps the clock held", () => {
    const { t, b } = heldLesson(3);
    expect(t.current?.id).toBe("spell");
    const before = { step: t.step, time: b.time, elixir: b.player.elixir.amount, units: b.entities.length };
    const st = newNudge();
    const r = pressNudge(st, t, b, "archers", 1000, (id) => getCard(id).name);
    expect(r).toEqual({ fresh: true, target: "fireball" });
    expect(nudgeLine(st, true, 1001)).toEqual(["Not that one. Use the glowing Fireball card!", expect.stringContaining("Fireball")]);
    // Nothing moved on: same step, the clock still held, nothing played.
    expect(t.step).toBe(before.step);
    expect(t.holds(b)).toBe(true);
    expect({ step: t.step, time: b.time, elixir: b.player.elixir.amount, units: b.entities.length }).toEqual(before);
    // The lesson's own line comes back after a moment.
    expect(nudgeLine(st, true, 1000 + NUDGE_MS - 1)).not.toBeNull();
    expect(nudgeLine(st, true, 1000 + NUDGE_MS)).toBeNull();
    // ...and only while the lesson holds the clock.
    expect(nudgeLine(st, false, 1001)).toBeNull();
  });

  it("a burst of presses wiggles once; a later press wiggles again", () => {
    const { t, b } = heldLesson(3);
    const st = newNudge();
    const name = (id: CardId): string => getCard(id).name;
    expect(pressNudge(st, t, b, "archers", 0, name)?.fresh).toBe(true);
    expect(pressNudge(st, t, b, "archers", NUDGE_BURST_MS - 1, name)?.fresh).toBe(false);
    expect(pressNudge(st, t, b, null, NUDGE_BURST_MS * 3, name)?.fresh).toBe(true);
    expect(nudgeLine(st, true, NUDGE_BURST_MS * 3)?.[0]).toBe("Drag the glowing Fireball card onto the glowing spot!");
  });

  it("in the King lesson, a card press points at the King's power", () => {
    const { t, b } = heldLesson(5);
    expect(t.current?.id).toBe("king");
    const st = newNudge();
    expect(pressNudge(st, t, b, "giant", 0, (id) => getCard(id).name)).toEqual({ fresh: true, target: null });
    expect(nudgeLine(st, true, 1)?.[0]).toBe("Not a card this time. Tap your glowing King power!");
    expect(t.holds(b)).toBe(true);
  });
});

describe("tutorial: the wrong press's release", () => {
  const copy: [string, string] = ["Not that one. Use the glowing Fireball card!", "ليست هذه. استخدم بطاقة قذيفة نفط المضيئة!"];
  const pressed = (at: number, pointer = 7) => {
    const st = newNudge();
    st.text = copy;
    st.until = at + NUDGE_MS;
    st.pointer = pointer;
    return st;
  };

  it("a slow, wrong drag gets the nudge again when it is dropped", () => {
    const st = pressed(0);
    expect(nudgeLine(st, true, 10_000)).toBeNull(); // the line had gone back mid-drag
    expect(releaseNudge(st, 7, 10_000)).toBe(true); // fresh: wiggle and replay the glove
    expect(nudgeLine(st, true, 10_001)).toEqual(copy);
    expect(releaseNudge(st, 7, 10_100)).toBeNull(); // once per press
  });

  it("a quick tap's release keeps the line up without a second wiggle", () => {
    const st = pressed(0);
    expect(releaseNudge(st, 7, 120)).toBe(false);
    expect(nudgeLine(st, true, NUDGE_MS + 100)).toEqual(copy);
  });

  it("ignores another finger, and a step that moved on", () => {
    const st = pressed(0);
    expect(releaseNudge(st, 8, 5000)).toBeNull();
    clearNudge(st);
    expect(releaseNudge(st, 7, 5000)).toBeNull();
    expect(nudgeLine(st, true, 5001)).toBeNull();
  });
});
