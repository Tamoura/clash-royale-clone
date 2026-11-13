import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { installFakeDom, pressKey, type FakeDocument, type FakeElement } from "./fakeDom.testkit";
import { oopsCopy, oopsOpen, showOops } from "./oops";

// vitest runs without localStorage, so the Golden Age (Arabic) strings show:
// the edition the overlay must read best in (right-to-left).
describe("the Oops overlay's words", () => {
  it("says what the brief asks, in Arabic in the Golden Age", () => {
    const g = oopsCopy("glitch");
    expect(g.title).toBe("عذرًا! حدث خطأ ما.");
    expect(g.keep).toBe("تابع اللعب");
    expect(g.back).toBe("العودة إلى القائمة");
    expect(g.first).toBe("keep");
    expect(oopsCopy("online").body).toBe("توقفت المباراة بسبب خلل. لم تربح أو تخسر أي كؤوس.");
  });

  it("puts Back to menu first when it failed again, and offers only it online", () => {
    expect(oopsCopy("again").first).toBe("back");
    expect(oopsCopy("online")).toMatchObject({ keep: null, first: "back" });
  });
});

describe("showOops", () => {
  let doc: FakeDocument;
  beforeEach(() => {
    doc = installFakeDom();
  });
  afterEach(() => {
    document.querySelectorAll(".oops-modal").forEach((n) => n.remove());
    vi.unstubAllGlobals();
  });

  const modal = (): FakeElement | null => doc.querySelector(".oops-modal");
  const buttons = (): FakeElement[] => doc.querySelectorAll(".oops-modal button");

  it("shows Keep playing first and focused, and each button closes it and acts once", () => {
    const calls: string[] = [];
    showOops("glitch", { onKeepPlaying: () => calls.push("keep"), onBackToMenu: () => calls.push("back") });
    expect(oopsOpen()).toBe(true);
    expect(modal()!.dir).toBe("rtl");
    expect(buttons().map((b) => b.className.includes("oops-keep"))).toEqual([true, false]);
    expect(buttons()[0].className).toContain("ui-btn--cta");
    expect(doc.activeElement).toBe(buttons()[0]);
    buttons()[0].click();
    expect(calls).toEqual(["keep"]);
    expect(modal()).toBeNull();
    expect(oopsOpen()).toBe(false);
  });

  it("after a repeat, Back to menu is the big first button", () => {
    const calls: string[] = [];
    showOops("again", { onKeepPlaying: () => calls.push("keep"), onBackToMenu: () => calls.push("back") });
    expect(buttons()[0].className).toContain("oops-back");
    expect(buttons()[0].className).toContain("ui-btn--cta");
    buttons()[0].click();
    expect(calls).toEqual(["back"]);
  });

  it("online offers only Back to menu", () => {
    showOops("online", { onBackToMenu: () => undefined });
    expect(buttons()).toHaveLength(1);
    expect(modal()!.textContent).toContain("لم تربح أو تخسر أي كؤوس");
  });

  it("Esc and the battle keys do nothing underneath; Tab stays on its buttons", () => {
    showOops("glitch", { onKeepPlaying: () => undefined, onBackToMenu: () => undefined });
    for (const key of ["Escape", "1", "q"]) expect(pressKey(doc, key).defaultPrevented).toBe(true);
    expect(modal()).not.toBeNull();
    pressKey(doc, "Tab");
    expect(doc.activeElement).toBe(buttons()[1]);
    pressKey(doc, "Tab");
    expect(doc.activeElement).toBe(buttons()[0]);
    expect(pressKey(doc, "Enter").defaultPrevented).toBe(false);
  });

  it("is never stacked: a second one replaces the first", () => {
    showOops("glitch", { onKeepPlaying: () => undefined, onBackToMenu: () => undefined });
    showOops("again", { onKeepPlaying: () => undefined, onBackToMenu: () => undefined });
    expect(doc.querySelectorAll(".oops-modal")).toHaveLength(1);
    expect(modal()!.dataset.kind).toBe("again");
  });
});
