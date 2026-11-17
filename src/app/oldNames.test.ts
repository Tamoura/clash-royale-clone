/**
 * The game's own names guard. The game was renamed Banner Lanes / درب الرايات
 * and stopped using another game's coined words. This test fails if a
 * player-facing string literal brings one back: every string and template
 * piece in src/**\/*.ts (outside the locked sim in src/game, whose canonical
 * names the display layer replaces, and outside tests), plus index.html and
 * the web-app manifest.
 *
 * Comments are not strings, so they may still mention the old names
 * (history, design notes). Internal ids are allowed: they are lower-case
 * ("hog-rider", "elixir-collector", icon "elixir", "cr-clone-*", the save
 * tag "crown-rush"), and the English patterns below are capitalised prose,
 * while lower-case "elixir" only counts inside a phrase ("Wait for the
 * elixir."), never as a bare id or inside a selector or class name.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import manifestRaw from "../../public/manifest.webmanifest?raw";

const ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname);
const rel = (f: string): string => f.replace(ROOT, "").replace(/\\/g, "/");

/** [what it is, pattern]: English names and words another game coined, or that the rename retired. */
const OLD_EN: [string, RegExp][] = [
  ["the old game names", /Crown Rush|Clash Royale|CR Clone/i],
  ["P.E.K.K.A", /P\.E\.K\.K\.A|PEKKA/],
  [
    "another game's card names",
    /Hog Rider|Mega Knight|Electro Wizard|Royal Giant|Skeleton Barrel|Skeleton Arm(y|ies)|Magic Archer|Elixir Collector|Minions?\b|Executioner|Iron Guard/,
  ],
  ["another game's arena names", /Training Camp|Goblin Stadium|Bone Pit|Barbarian Bowl|Playhouse|Spell Valley|Builder's Workshop|Royal Arena|Frozen Peak|Jungle Arena|Legendary Peak/],
  ["another game's feature names", /Trophy Road|Princess towers?|Dagger Duchess|Bridge Spam|Hog Rush|Mega Drop/i],
  ["the trail's old name", /\bRoad\b|end of the road|الطريق/],
  ["the resource's old name", /\bElixir\b/],
  ["the old credit line", /fan-made|\btribute\b/i],
  ["words too grim for ages 6-12", /ruthless|death bomb|deadly/i],
];

/** Lower-case "elixir" as a word in a phrase: not an id ("elixir"), a class (.elixir-row) or a selector. */
const ELIXIR_PROSE = /(^|[\s(])elixir(s)?($|[\s.,!?:;)])/i;

/** Arabic names the rename and the Arabic review replaced. */
const OLD_AR: [string, RegExp][] = [
  ["the old Golden Age title", /هجمة التاج/],
  ["the resource's old name", /إكسير/],
  ["the replaced Golden Age card names", /ميليشيا|الجلّاد|خولة|رباط|طبول الحرب|الكشّافة|دوقة الخناجر/],
  ["the replaced Golden Age words", /تعويذ|تعاويذ|طريق الكؤوس|برج أميرة|أبراج أميرات|قنبلة موت|ولا يرحم|سحرة/],
];

function offences(text: string): string[] {
  const out: string[] = [];
  for (const [what, re] of [...OLD_EN, ...OLD_AR]) if (re.test(text)) out.push(what);
  if (/\s/.test(text.trim()) && ELIXIR_PROSE.test(text)) out.push("the resource's old name");
  return out;
}

/** Every string and template piece in the app's TypeScript (no comments: the scanner skips them). */
function literals(): { where: string; text: string }[] {
  const cfg = ts.getParsedCommandLineOfConfigFile(`${ROOT}tsconfig.json`, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  });
  if (!cfg) throw new Error("tsconfig.json did not parse");
  const files = cfg.fileNames.filter((f) => {
    const r = rel(f);
    return r.startsWith("src/") && !r.startsWith("src/game/") && !/\.test\.ts$|testkit\.ts$/.test(r);
  });
  const out: { where: string; text: string }[] = [];
  for (const f of files) {
    const sf = ts.createSourceFile(f, ts.sys.readFile(f) ?? "", ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      const at = (): string => `${rel(f)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push({ where: at(), text: n.text });
      else if (ts.isTemplateExpression(n)) {
        for (const piece of [n.head.text, ...n.templateSpans.map((s) => s.literal.text)]) out.push({ where: at(), text: piece });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** index.html without its comments (HTML, CSS and script comments may keep history). */
const htmlText = (): string =>
  indexHtml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the game's own names: no old or coined name in player-facing text", () => {
  const all = literals();

  it("reads the app's sources, and not the locked sim", () => {
    const files = new Set(all.map((l) => l.where.replace(/:\d+$/, "")));
    for (const f of ["src/main.ts", "src/render/cardNames.ts", "src/ui/screens/settings.ts", "src/render3d/hud.ts"]) expect(files).toContain(f);
    expect([...files].some((f) => f.startsWith("src/game/"))).toBe(false);
  });

  it("finds none in a string literal under src (outside src/game and tests)", () => {
    const bad = all.flatMap(({ where, text }) => offences(text).map((what) => `${where}: ${what}: ${JSON.stringify(text)}`));
    expect(bad).toEqual([]);
  });

  it("finds none in index.html or the web-app manifest", () => {
    expect(offences(htmlText())).toEqual([]);
    expect(offences(manifestRaw)).toEqual([]);
  });

  it("would catch each kind of slip (the guard itself works)", () => {
    for (const slip of [
      "Crown Rush",
      "Hog Rider",
      "P.E.K.K.A",
      "Mini P.E.K.K.A",
      "Elixir",
      "Wait for the elixir.",
      "3x elixir",
      "Goblin Stadium",
      "Trophy Road",
      "Road reward ready",
      "مكافأة الطريق جاهزة",
      "Princess tower fell",
      "A fan-made tribute.",
      "هجمة التاج",
      "٣ إكسير",
      "يستدعي الميليشيا",
      "طبول الحرب",
      "تعويذة",
    ]) {
      expect(offences(slip), slip).not.toEqual([]);
    }
    // ...and lets the ids through.
    for (const id of ["elixir", "no-elixir", "elixir-collector", "#hud .elixir-row", '#hud [data-tut="elixir"]', "hog-rider", "minions", "crown-rush", "cr-clone-arena-theme"]) {
      expect(offences(id), id).toEqual([]);
    }
  });
});
