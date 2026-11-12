import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import manifestRaw from "../../public/manifest.webmanifest?raw";
import { ARENA_THEME_KEY } from "../render3d/theme";
import { GAME_NAME, GAME_NAME_AR, gameName, localizeStaticMarkup } from "./brand";

/** The text of the first element matching `re` (group 1). */
const grab = (re: RegExp): string | undefined => re.exec(indexHtml)?.[1];

describe("the game's name is Crown Rush", () => {
  it("on the tab, the home-screen label and the boot splash", () => {
    expect(GAME_NAME).toBe("Crown Rush");
    expect(grab(/<title>([^<]*)<\/title>/)).toBe(GAME_NAME);
    expect(grab(/<meta name="apple-mobile-web-app-title" content="([^"]*)"/)).toBe(GAME_NAME);
    expect(grab(/<div class="boot-title">([^<]*)<\/div>/)).toBe(GAME_NAME);
  });

  it("in the web-app manifest (the installed icon's name)", () => {
    const m = JSON.parse(manifestRaw) as { name: string; short_name: string };
    expect(m.name).toBe(GAME_NAME);
    expect(m.short_name).toBe(GAME_NAME);
    // Home screens cut labels past about 12 characters.
    expect(m.short_name.length).toBeLessThanOrEqual(12);
  });

  it("never the copied name the game started with", () => {
    for (const text of [indexHtml, manifestRaw]) {
      expect(text).not.toMatch(/Clash Royale|CR Clone/i);
    }
  });

  it("keeps the internal ids, so no save is lost", () => {
    expect(ARENA_THEME_KEY).toBe("cr-clone-arena-theme");
  });

  it("is Arabic on the tab, the splash and the emote bar in the Golden Age edition", () => {
    // Node tests run the Golden Age edition.
    expect(gameName()).toBe(GAME_NAME_AR);
    expect(GAME_NAME_AR).toMatch(/^[؀-ۿ ]+$/);
    const attrs: Record<string, string> = {};
    const boot = { textContent: "Crown Rush" };
    const doc = {
      title: "Crown Rush",
      querySelector: (sel: string) => (sel === "#boot .boot-title" ? boot : null),
      getElementById: (id: string) => (id === "emotes" ? { setAttribute: (k: string, v: string) => void (attrs[k] = v) } : null),
    } as unknown as Document;
    localizeStaticMarkup(doc);
    expect(doc.title).toBe(GAME_NAME_AR);
    expect(boot.textContent).toBe(GAME_NAME_AR);
    expect(attrs["aria-label"]).toBe("التعابير");
  });

  it("does not put dir=rtl on <html> (the battle HUD stays left to right)", () => {
    expect(indexHtml).toMatch(/<html lang="en">/);
    expect(indexHtml).not.toMatch(/<html[^>]*dir=/);
  });
});
