import { afterEach, describe, expect, it, vi } from "vitest";
import mainSrc from "../main.ts?raw";
import noWebglSrc from "./noWebgl.ts?raw";
import { FakeEvent, installFakeDom, type FakeElement } from "../ui/fakeDom.testkit";
import { noWebglWords, showNoWebgl } from "./noWebgl";

afterEach(() => vi.unstubAllGlobals());

describe("the no-WebGL screen", () => {
  it("is a friendly card in the edition's language, over everything, with the splash taken down", () => {
    const doc = installFakeDom();
    const reload = vi.fn();
    showNoWebgl(doc as unknown as Document, reload);
    const screen = doc.querySelector(".nogl") as FakeElement;
    expect(screen).toBeTruthy();
    expect(screen.parentElement).toBe(doc.body);
    expect(screen.getAttribute("role")).toBe("alert");
    // Node tests run the Golden Age edition: Arabic, right to left on the card only.
    expect(screen.getAttribute("dir")).toBe("rtl");
    expect(screen.getAttribute("lang")).toBe("ar");
    expect(doc.documentElement.getAttribute("dir")).toBeNull();
    const words = noWebglWords();
    const text = screen.textContent;
    for (const line of [words.title, words.kid, words.ask, words.grownUps, words.hint, words.retry]) expect(text).toContain(line);
    expect(doc.body.classList.contains("booted")).toBe(true);
    // Try again reloads (after a grown-up switched graphics on).
    (screen.querySelector(".nogl__retry") as FakeElement).dispatchEvent(new FakeEvent("click"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("says it simply: Arabic words with no Latin letters or digits, a kid line and a grown-up hint in English", () => {
    const words = noWebglWords();
    for (const line of [words.title, words.kid, words.ask, words.grownUps, words.hint, words.retry]) {
      expect(line).toMatch(/[؀-ۿ]/);
      expect(line).not.toMatch(/[A-Za-z0-9]/);
    }
    // The English side, as written in the source.
    expect(noWebglSrc).toContain("This game needs 3D graphics, and they are switched off in this browser.");
    expect(noWebglSrc).toContain("Turn on hardware acceleration");
    expect(noWebglSrc).toContain("Or open the game in another browser.");
    expect(noWebglSrc).not.toMatch(/chrome:\/\//);
  });

  it("is what main.ts shows when the 3D scene cannot start, before it stops the boot", () => {
    const at = mainSrc.indexOf("scene = new Battle3D(stage);");
    const block = mainSrc.slice(at, mainSrc.indexOf('throw new Error("WebGL unavailable")', at) + 40);
    expect(block).toContain("showNoWebgl(document);");
    expect(block.indexOf("showNoWebgl(")).toBeLessThan(block.indexOf("throw new Error"));
    expect(mainSrc).not.toContain("chrome://settings/system");
  });
});
