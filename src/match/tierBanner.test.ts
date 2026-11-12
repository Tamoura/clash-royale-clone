import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit, type MatchEndPayload } from "../app/hooks";
import { resultExtras } from "../app/slots";
import { createBattle } from "../game/battle";
import { AUTO_KEY, DIFF_KEY, autoStep, installAutoDifficulty, loadAutoState, type AutoState } from "./difficulty";
import { TIER_STEP_LINES, tierBannerElement, tierBannerText, tierStepFor } from "./tierBanner";

/** Just enough of an element for the banner and the coach tip (no DOM in this test environment). */
class FakeEl {
  className = "";
  dir = "";
  html = "";
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly attrs = new Map<string, string>();
  children: Array<FakeEl | string> = [];
  private own = "";
  constructor(readonly tagName: string) {}
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  insertAdjacentHTML(_where: string, html: string): void {
    this.html += html;
  }
  appendChild<T extends FakeEl | string>(c: T): T {
    this.children.push(c);
    return c;
  }
  append(...cs: Array<FakeEl | string>): void {
    this.children.push(...cs);
  }
  get textContent(): string {
    return this.own + this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  set textContent(v: string) {
    this.own = v;
    this.children = [];
  }
}

const fakeDocument = {
  createElement: (tag: string) => new FakeEl(tag),
  createTextNode: (text: string) => text,
};

const ARABIC_SCRIPT = /[؀-ۿ]/;
const LATIN = /[A-Za-z0-9]/;
const EMOJI = /\p{Extended_Pictographic}/u;

describe("the tier banner's words", () => {
  it("cheers a step up and softens a step down, in both languages", () => {
    expect(TIER_STEP_LINES.up[0]).toBe("The bot is getting smarter!");
    expect(TIER_STEP_LINES.down[0]).toBe("The bot will go easier next time");
    for (const [en, ar] of Object.values(TIER_STEP_LINES)) {
      expect(en.length).toBeGreaterThan(0);
      expect(ar).toMatch(ARABIC_SCRIPT);
      expect(ar).not.toMatch(LATIN); // no English words or Latin digits in the Golden Age line
      expect(en + ar).not.toMatch(EMOJI);
    }
  });

  it("reads the edition: Golden Age shows the Arabic line", () => {
    // Under Node the theme module defaults to the Golden Age edition (theme.ts).
    expect(tierBannerText("up")).toBe(TIER_STEP_LINES.up[1]);
    expect(tierBannerText("down")).toBe(TIER_STEP_LINES.down[1]);
  });

  it("reads the edition: Classic shows the English line, left to right", async () => {
    vi.resetModules();
    const mem = new Map([["cr-clone-arena-theme", "normal"]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal("document", fakeDocument);
    try {
      const classic = await import("./tierBanner");
      expect(classic.tierBannerText("up")).toBe("The bot is getting smarter!");
      expect(classic.tierBannerText("down")).toBe("The bot will go easier next time");
      const el = classic.tierBannerElement("up") as unknown as FakeEl;
      expect(el.dir).toBe("");
      expect(el.textContent).toBe("The bot is getting smarter!");
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe("the tier banner element", () => {
  beforeEach(() => vi.stubGlobal("document", fakeDocument));
  afterEach(() => vi.unstubAllGlobals());

  it("is a status row with an icon and the line, right to left in Golden Age", () => {
    const up = tierBannerElement("up") as unknown as FakeEl;
    expect(up.className).toBe("ui-tier-banner ui-tier-banner--up");
    expect(up.dataset.step).toBe("up");
    expect(up.getAttribute("role")).toBe("status");
    expect(up.dir).toBe("rtl");
    expect(up.html).toContain('class="ui-icon');
    expect(up.textContent).toBe(TIER_STEP_LINES.up[1]);
    const down = tierBannerElement("down") as unknown as FakeEl;
    expect(down.className).toBe("ui-tier-banner ui-tier-banner--down");
    expect(down.textContent).toBe(TIER_STEP_LINES.down[1]);
  });
});

describe("auto difficulty tells the kid when the bot moves", () => {
  const mem = new Map<string, string>();
  const store = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  let off: () => void = () => {};
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal("localStorage", store);
    vi.stubGlobal("document", fakeDocument);
    off = installAutoDifficulty(() => 400);
  });
  afterEach(() => {
    off();
    vi.unstubAllGlobals();
  });

  const save = (s: AutoState): void => void mem.set(AUTO_KEY, JSON.stringify(s));
  const diffs = (...d: number[]) => d.map((crownDiff) => ({ crownDiff }));
  function finish(myCrowns: number, theirCrowns: number, extra: Partial<MatchEndPayload> = {}): MatchEndPayload {
    const end: MatchEndPayload = {
      kind: "ladder",
      winner: myCrowns > theirCrowns ? "player" : myCrowns < theirCrowns ? "enemy" : "draw",
      mySide: "player",
      myCrowns,
      theirCrowns,
      trophyDelta: 0,
      online: false,
      battle: createBattle(),
      replay: false,
      sandbox: false,
      ...extra,
    };
    emit("matchEnd", end);
    return end;
  }
  const banners = (end: MatchEndPayload) =>
    (resultExtras(end) as unknown as FakeEl[]).filter((e) => e.className.startsWith("ui-tier-banner"));

  it("steps up after the second decisive window and says the bot is getting smarter", () => {
    mem.set(DIFF_KEY, "auto");
    save({ v: 1, ladderMatches: 12, tier: "easy", history: diffs(1, 1, 1, 1, 1) });
    const end = finish(1, 0);
    expect(loadAutoState(400).tier).toBe("normal");
    expect(tierStepFor(end.battle)).toBe("up");
    const shown = banners(end);
    expect(shown).toHaveLength(1);
    expect(shown[0].dataset.step).toBe("up");
    expect(shown[0].textContent).toBe(TIER_STEP_LINES.up[1]);
    // Built twice (the result screen can be), still one banner each time.
    expect(banners(end)).toHaveLength(1);
  });

  it("never cheers a step up under DEFEAT: the climb waits for the next match not lost", () => {
    mem.set(DIFF_KEY, "auto");
    save({ v: 1, ladderMatches: 12, tier: "easy", history: diffs(3, 1, 0, 2, 2) });
    const lost = finish(0, 1); // closes two +3 windows, but it is a defeat
    expect(loadAutoState(400).tier).toBe("easy");
    expect(banners(lost)).toHaveLength(0);
    const won = finish(2, 0); // windows 1+0+2 and 2-1+2: both still decisive
    expect(loadAutoState(400).tier).toBe("normal");
    expect(banners(won).map((b) => b.dataset.step)).toEqual(["up"]);
  });

  it("steps down and kindly says the bot will go easier, above the coach tip", () => {
    mem.set(DIFF_KEY, "auto");
    save({ v: 1, ladderMatches: 12, tier: "normal", history: diffs(-1, -1) });
    const end = finish(0, 1);
    expect(loadAutoState(400).tier).toBe("easy");
    const extras = resultExtras(end) as unknown as FakeEl[];
    expect(extras[0].dataset.step).toBe("down");
    expect(extras[0].textContent).toBe(TIER_STEP_LINES.down[1]);
    expect(extras.some((e) => e.className === "ui-coach-tip")).toBe(true);
  });

  it("stays quiet when the tier holds", () => {
    mem.set(DIFF_KEY, "auto");
    save({ v: 1, ladderMatches: 12, tier: "easy", history: diffs(1, 1) });
    const end = finish(1, 0);
    expect(loadAutoState(400).tier).toBe("easy");
    expect(banners(end)).toHaveLength(0);
  });

  it("stays quiet for a tier the player picked (auto still keeps its record)", () => {
    mem.set(DIFF_KEY, "hard");
    save({ v: 1, ladderMatches: 12, tier: "easy", history: diffs(1, 1, 1, 1, 1) });
    const end = finish(1, 0);
    expect(loadAutoState(400).tier).toBe("normal");
    expect(banners(end)).toHaveLength(0);
  });

  it("ignores replays, sandbox and online games", () => {
    mem.set(DIFF_KEY, "auto");
    for (const extra of [{ replay: true }, { sandbox: true }, { online: true }]) {
      save({ v: 1, ladderMatches: 12, tier: "easy", history: diffs(1, 1, 1, 1, 1) });
      const end = finish(1, 0, extra);
      expect(loadAutoState(400).tier).toBe("easy");
      expect(banners(end)).toHaveLength(0);
    }
  });

  it("autoStep compares the tiers the auto option actually plays", () => {
    const at = (tier: AutoState["tier"], ladderMatches = 12): AutoState => ({ v: 1, ladderMatches, tier, history: [] });
    expect(autoStep(at("easy"), at("normal"))).toBe("up");
    expect(autoStep(at("rookie"), at("practice"))).toBe("down");
    expect(autoStep(at("practice", 2), at("rookie", 3))).toBe("up");
    expect(autoStep(at("rookie", 2), at("rookie", 3))).toBeNull();
  });
});
