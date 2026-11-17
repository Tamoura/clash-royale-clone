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
 * Arabic is compared without harakat, shadda or tatweel and with every alef
 * form as a bare alef, so "الجلاد" counts as "الجلّاد" and "اكسير" as "إكسير".
 *
 * The second guard closes the other way back: code that reads the sim's own
 * words (a card's `name`, a challenge's or tower troop's name and blurb, a
 * tutorial step's text) and so skips the display layer that swaps in each
 * edition's names. It uses the type checker, so `getCard(id).name`,
 * `const c = getCard(id); c.name` and `ch.name` on a Challenge all count,
 * wherever they are outside the one display module for that data.
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

/**
 * Arabic names the rename and the Arabic review replaced, written in the
 * plain form arabicPlain() gives (no shadda, bare alef), so every spelling
 * of them counts.
 */
const OLD_AR: [string, RegExp][] = [
  ["the old Golden Age title", /هجمة التاج/],
  ["the resource's old name", /اكسير/],
  ["the replaced Golden Age card names", /ميليشيا|الجلاد|خولة|رباط|طبول الحرب|الكشافة|دوقة الخناجر/],
  ["the replaced Golden Age words", /تعويذ|تعاويذ|طريق الكؤوس|برج اميرة|ابراج اميرات|قنبلة موت|ولا يرحم|سحرة/],
];

/**
 * Arabic as it is often typed: harakat, shadda, sukun, the dagger alef
 * (U+064B to U+0652, U+0670) and tatweel (U+0640) dropped, and every alef
 * with a hamza or madda (أ إ آ ٱ) written as a bare alef.
 */
function arabicPlain(text: string): string {
  return text.replace(/[\u064B-\u0652\u0670\u0640]/g, "").replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627");
}

function offences(text: string): string[] {
  const out: string[] = [];
  for (const [what, re] of OLD_EN) if (re.test(text)) out.push(what);
  const plain = arabicPlain(text);
  for (const [what, re] of OLD_AR) if (re.test(plain)) out.push(what);
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
      // The same names as they are often typed: no shadda, a bare alef.
      "الجلاد يرمي فأسه",
      "الجلّاد",
      "الكشافة",
      "اكسير",
      "الإكسـير",
      "سَحَرة",
      "برج أميرة",
      "برج اميرة",
    ]) {
      expect(offences(slip), slip).not.toEqual([]);
    }
    // ...and lets the ids through.
    for (const id of ["elixir", "no-elixir", "elixir-collector", "#hud .elixir-row", '#hud [data-tut="elixir"]', "hog-rider", "minions", "crown-rush", "cr-clone-arena-theme"]) {
      expect(offences(id), id).toEqual([]);
    }
  });
});

/**
 * The sim's own words, by the module that declares them, and the one display
 * module allowed to read them. Everywhere else shows the display layer's
 * words: cardDisplayName / cardNameIn, challengeName / challengeBlurb,
 * towerTroopName / towerTroopBlurb, stepText.
 */
const SIM_WORDS: { decl: string; fields: string[]; reader: string; instead: string }[] = [
  { decl: "src/game/cards.ts", fields: ["name"], reader: "src/render/cardNames.ts", instead: "cardDisplayName(id) or cardNameIn(id, arabic)" },
  { decl: "src/game/challenges.ts", fields: ["name", "nameAr", "blurb", "blurbAr"], reader: "src/render/challengeText.ts", instead: "challengeName(ch) or challengeBlurb(ch)" },
  { decl: "src/game/towers.ts", fields: ["name", "ar", "blurb", "blurbAr"], reader: "src/render/towerTroopText.ts", instead: "towerTroopName(id) or towerTroopBlurb(id)" },
  { decl: "src/game/tutorial.ts", fields: ["text"], reader: "src/ui/tutorialOverlay.ts", instead: "stepText(step)" },
];

/**
 * A file the guard checks itself on: each line reads a sim word the way a
 * slip would. It exists only inside the guard's program, never on disk.
 */
const PROBE = "src/__simWordsProbe.ts";
const PROBE_TEXT = `
import { getCard, type Card } from "./game/cards";
import { CHALLENGES } from "./game/challenges";
import { TOWER_TROOPS } from "./game/towers";
import { TUTORIAL_STEPS } from "./game/tutorial";
export const a = getCard("pekka").name;
const card: Card = getCard("hog-rider");
export const b = card.name;
const ch = CHALLENGES[0];
export const c = ch.name;
export const d = ch.blurbAr;
export const e = TOWER_TROOPS.duchess.name;
export const f = TOWER_TROOPS["duchess"]["blurb"];
const { name: g } = getCard("minions");
export const h = [g, TUTORIAL_STEPS[0].text];
`;
/** What each probe read looks like in the guard's report. */
const PROBE_SLIPS = ['getCard("pekka").name', "card.name", "ch.name", "ch.blurbAr", "TOWER_TROOPS.duchess.name", 'TOWER_TROOPS["duchess"]["blurb"]', "name: g", "TUTORIAL_STEPS[0].text"];

/** Every read of a sim word outside its display module ("file:line: what"). */
function simWordReads(): { app: string[]; probe: string[] } {
  const cfg = ts.getParsedCommandLineOfConfigFile(`${ROOT}tsconfig.json`, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  });
  if (!cfg) throw new Error("tsconfig.json did not parse");
  const app = cfg.fileNames.filter((f) => {
    const r = rel(f);
    return r.startsWith("src/") && !r.startsWith("src/game/") && !/\.test\.ts$|testkit\.ts$/.test(r);
  });
  const probePath = `${ROOT}${PROBE}`;
  const options = { ...cfg.options, noEmit: true, types: [] };
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, ...rest) =>
    f === probePath ? ts.createSourceFile(f, PROBE_TEXT, lang, true) : getSourceFile(f, lang, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (f) => f === probePath || fileExists(f);
  const program = ts.createProgram({ rootNames: [...app, probePath], options, host });
  const checker = program.getTypeChecker();

  /** The SIM_WORDS entry a property symbol belongs to, if any. */
  const simWord = (sym: ts.Symbol | undefined): (typeof SIM_WORDS)[number] | undefined => {
    if (!sym) return undefined;
    // A property of a union (Card) lists each member's declaration.
    for (const d of sym.declarations ?? []) {
      const at = rel(d.getSourceFile().fileName);
      const w = SIM_WORDS.find((x) => x.decl === at && x.fields.includes(sym.name));
      if (w) return w;
    }
    return undefined;
  };

  const out = { app: [] as string[], probe: [] as string[] };
  for (const sf of program.getSourceFiles()) {
    const file = rel(sf.fileName);
    const isProbe = sf.fileName === probePath;
    if (!isProbe && !app.includes(sf.fileName)) continue;
    const visit = (n: ts.Node): void => {
      let sym: ts.Symbol | undefined;
      if (ts.isPropertyAccessExpression(n)) sym = checker.getSymbolAtLocation(n.name);
      else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) {
        sym = checker.getSymbolAtLocation(n.argumentExpression);
      } else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
        const key = n.propertyName ?? n.name;
        if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) {
          sym = checker.getPropertyOfType(checker.getApparentType(checker.getTypeAtLocation(n.parent)), key.text);
        }
      }
      const w = simWord(sym);
      if (w && file !== w.reader) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        (isProbe ? out.probe : out.app).push(`${file}:${line}: ${n.getText(sf)} reads ${w.decl} ${sym?.name}; show ${w.instead}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

describe("the game's own names: no screen text read straight from the sim", () => {
  const reads = simWordReads();

  it("finds no read of a card's, challenge's, tower troop's or tutorial step's own words outside its display module", () => {
    expect(reads.app).toEqual([]);
  });

  it("would catch each kind of read (the guard itself works)", () => {
    expect(reads.probe).toHaveLength(PROBE_SLIPS.length);
    for (const slip of PROBE_SLIPS) {
      expect(reads.probe.some((r) => r.includes(`: ${slip} reads`)), slip).toBe(true);
    }
  });
});
