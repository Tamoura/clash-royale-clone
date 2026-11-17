/**
 * Sacred marks are never decoration. The Golden Age edition is for Gulf
 * families: a Quran annotation sign used as an ornament (the Rub el Hizb
 * U+06DE once sat above the card hand) or an honorific ligature such as the
 * Bismillah would be disrespectful. This fails if one appears, typed or as a
 * CSS escape, in the stylesheets, index.html or the app's sources.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Quran annotation signs (U+06D6 to U+06ED) and honorific ligatures (U+FDFA to U+FDFD). */
const SACRED_CHAR = /[ۖ-ۭﷺ-﷽]/u;
/** The same code points written as a CSS or JS escape ("\06DE", "۞"). */
const SACRED_ESCAPE = /\\(?:u0?|0*)(?:6D[6-9A-F]|6E[0-9A-D]|FDF[A-D])(?![0-9A-F])/i;

const ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname);

/** Every file under src/ whose name passes `keep`, read from disk, by path from the repo root. */
function read(keep: (name: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(`${ROOT}src`, { recursive: true, encoding: "utf8" })) {
    const name = f.replace(/\\/g, "/");
    if (keep(name)) out[`src/${name}`] = readFileSync(`${ROOT}src/${name}`, "utf8");
  }
  return out;
}

// Read from disk: vitest serves a stylesheet imported "?raw" as empty text.
const styles = read((f) => f.endsWith(".css"));
const sources = read((f) => /\.(ts|html)$/.test(f) && !f.endsWith(".test.ts"));
const indexHtml = readFileSync(`${ROOT}index.html`, "utf8");

const offences = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .filter(([, text]) => SACRED_CHAR.test(text) || SACRED_ESCAPE.test(text))
    .map(([file]) => file);

describe("no sacred mark used as an ornament", () => {
  it("reads the stylesheets and the sources", () => {
    expect(styles["src/ui/style.css"]).toMatch(/#hud::before/);
    expect(Object.keys(styles).length).toBeGreaterThan(5);
    expect(sources["src/main.ts"]?.length).toBeGreaterThan(1000);
  });

  it("finds none in a stylesheet, index.html or a source file", () => {
    expect(offences(styles)).toEqual([]);
    expect(offences(sources)).toEqual([]);
    expect(offences({ "index.html": indexHtml })).toEqual([]);
  });

  it("would catch each form (the guard itself works)", () => {
    for (const slip of ['content: "\\2726 \\06DE \\2726";', 'content: "\\6DE";', "۞", "۝", "﷽", 'el.textContent = "\\u06DE";']) {
      expect(offences({ slip }), slip).toEqual(["slip"]);
    }
    for (const fine of ['content: "\\2726 \\2756 \\2726";', "درب الرايات", "المشاة", 'content: "\\06DEAD";']) {
      expect(offences({ fine }), fine).toEqual([]);
    }
  });
});
