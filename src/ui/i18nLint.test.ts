/**
 * Golden Age language lint. The Golden Age edition reads Arabic and shows
 * numbers in Arabic-Indic digits (fmtNum), so it fails on:
 *
 * 1. An English-only aria-label (src/ui and src/main.ts): a screen reader in
 *    the Golden Age edition would read English. Labels go through tr().
 * 2. A number dropped raw into the Arabic half of a tr() call
 *    (`${count} صندوق`): it prints Latin digits next to Arabic words. The
 *    TypeScript checker decides what a number is, so a name or a card name
 *    passes and a count, cost or HP does not. Wrap it in fmtNum().
 * 3. Latin digits typed into the Arabic half of a tr() call ("+100").
 *
 * The allowlists are short on purpose; each entry says why.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname);
const rel = (f: string): string => f.replace(ROOT, "").replace(/\\/g, "/");

/** English-only aria-label literals that are allowed, as "file: text". */
const ARIA_ALLOW = new Set<string>([
  // The emote picker's toggle belongs to round 1's "kind" package, which
  // translates it (tr("Emotes", "التعابير")) along with the new emote set.
  "src/main.ts: Emotes",
]);

/** Raw numbers allowed in an Arabic string, as "file: expression". */
const NUMBER_ALLOW = new Set<string>([
  // The old season-reset banner; round 1's "kind" package replaces it with
  // a season-start toast that names the season (Arabic digits) and no counts.
  "src/main.ts: from",
  "src/main.ts: seasonRoll.trophies",
]);

const LATIN = /[A-Za-z]/;
const ARABIC_LETTER = /[؀-ۿ]/;

function program(): { prog: ts.Program; files: string[] } {
  const configPath = `${ROOT}tsconfig.json`;
  const cfg = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  });
  if (!cfg) throw new Error("tsconfig.json did not parse");
  const files = cfg.fileNames.filter((f) => !/\.test\.ts$|testkit\.ts$/.test(f));
  return { prog: ts.createProgram(files, cfg.options), files };
}

/** A call to tr(en, ar) or something.tr(en, ar). */
function isTr(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || node.arguments.length !== 2) return false;
  const c = node.expression;
  return (ts.isIdentifier(c) && c.text === "tr") || (ts.isPropertyAccessExpression(c) && c.name.text === "tr");
}

/** The fixed text pieces of a string or template argument. */
function staticText(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
  return [];
}

/**
 * Text a label shows as is: string pieces in `expr` that are not inside a
 * call (tr("…", "…") and helpers like icon("coin") build their own text).
 */
function shownLiterals(expr: ts.Node): string[] {
  const out: string[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) return;
    // cond ? a : b shows a or b, never the condition's own strings.
    if (ts.isConditionalExpression(n)) return void [n.whenTrue, n.whenFalse].forEach(walk);
    // Comparisons ("x" === state) decide, they don't show.
    if (ts.isBinaryExpression(n) && !SHOWN_OPERATORS.has(n.operatorToken.kind)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      out.push(...staticText(n as ts.Expression));
      if (ts.isTemplateExpression(n)) n.templateSpans.forEach((s) => walk(s.expression));
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(expr);
  return out;
}

/** Binary operators whose operands can end up in the label: a ?? "x", a + "x". */
const SHOWN_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.PlusToken,
]);

const englishOnly = (text: string): boolean => LATIN.test(text) && !ARABIC_LETTER.test(text);

/** True when `type` is a number (or a number that may be null/undefined). */
function isNumeric(type: ts.Type): boolean {
  const parts = type.isUnion() ? type.types : [type];
  const real = parts.filter((t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
  return real.length > 0 && real.every((t) => (t.flags & ts.TypeFlags.NumberLike) !== 0);
}

const { prog, files } = program();
const checker = prog.getTypeChecker();
const sources = files.map((f) => prog.getSourceFile(f)!).filter(Boolean);
const where = (sf: ts.SourceFile, n: ts.Node): string => `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;

describe("Golden Age language lint", () => {
  it("reads the whole app", () => {
    const names = sources.map((s) => rel(s.fileName));
    for (const f of ["src/main.ts", "src/ui/screens/home.ts", "src/render/cardinfo.ts", "src/ui/screens/lobby.ts"]) {
      expect(names).toContain(f);
    }
  });

  it("has no English-only aria-label in src/ui or src/main.ts", () => {
    const offenders: string[] = [];
    const flag = (sf: ts.SourceFile, at: ts.Node, text: string): void => {
      const file = rel(sf.fileName);
      if (englishOnly(text) && !ARIA_ALLOW.has(`${file}: ${text.trim()}`)) offenders.push(`${where(sf, at)}: ${JSON.stringify(text)}`);
    };
    for (const sf of sources) {
      const file = rel(sf.fileName);
      if (!(file.startsWith("src/ui/") || file === "src/main.ts")) continue;
      const visit = (n: ts.Node): void => {
        // el.setAttribute("aria-label", <label>)
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === "setAttribute" &&
          n.arguments.length === 2 &&
          ts.isStringLiteral(n.arguments[0]) &&
          n.arguments[0].text === "aria-label"
        ) {
          for (const t of shownLiterals(n.arguments[1])) flag(sf, n, t);
        }
        // button({ ariaLabel: <label> }) and the like
        if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "ariaLabel") {
          for (const t of shownLiterals(n.initializer)) flag(sf, n, t);
        }
        // aria-label="…" written into markup
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
          for (const m of n.text.matchAll(/aria-label="([^"]*)"?/g)) flag(sf, n, m[1]);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });

  it("never drops a raw number into an Arabic string (wrap it in fmtNum)", () => {
    const offenders: string[] = [];
    for (const sf of sources) {
      const file = rel(sf.fileName);
      const visit = (n: ts.Node): void => {
        if (isTr(n)) {
          const ar = n.arguments[1];
          if (ts.isTemplateExpression(ar)) {
            for (const span of ar.templateSpans) {
              const text = span.expression.getText(sf);
              if (isNumeric(checker.getTypeAtLocation(span.expression)) && !NUMBER_ALLOW.has(`${file}: ${text}`)) {
                offenders.push(`${where(sf, span.expression)}: \${${text}}`);
              }
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });

  it("types no Latin digits into an Arabic string", () => {
    const offenders: string[] = [];
    for (const sf of sources) {
      const visit = (n: ts.Node): void => {
        if (isTr(n)) {
          const text = staticText(n.arguments[1]).join("");
          if (/[0-9]/.test(text)) offenders.push(`${where(sf, n)}: ${JSON.stringify(text)}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });

  it("catches what it is meant to catch", () => {
    // A tiny program with one of each mistake, checked by the same rules.
    const src = [
      'declare function tr(en: string, ar: string): string;',
      'declare const el: { setAttribute(k: string, v: string): void };',
      'const count: number = 3; const name = "Amal";',
      'el.setAttribute("aria-label", "Open the chest");',
      'declare const state: string; declare const lbl: string | undefined;',
      'el.setAttribute("aria-label", state === "max" ? tr("Max", "الأعلى") : lbl ?? "Back");',
      'tr(`${count} chests`, `${count} صناديق`);',
      'tr(`${name} wins`, `${name} يفوز`);',
      'tr("+100 gold", "+100 ذهب");',
    ].join("\n");
    const host = ts.createCompilerHost({});
    const real = host.getSourceFile;
    host.getSourceFile = (f, v) => (f === "probe.ts" ? ts.createSourceFile(f, src, v, true) : real.call(host, f, v));
    const p = ts.createProgram(["probe.ts"], { noLib: true, types: [] }, host);
    const sf = p.getSourceFile("probe.ts")!;
    const c = p.getTypeChecker();
    const found: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "setAttribute") {
        found.push(...shownLiterals(n.arguments[1]).filter(englishOnly).map((t) => `aria:${t}`));
      }
      if (isTr(n)) {
        const ar = n.arguments[1];
        if (ts.isTemplateExpression(ar)) {
          for (const s of ar.templateSpans) if (isNumeric(c.getTypeAtLocation(s.expression))) found.push(`num:${s.expression.getText(sf)}`);
        }
        if (/[0-9]/.test(staticText(ar).join(""))) found.push(`digits:${staticText(ar).join("")}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(found).toEqual(["aria:Open the chest", "aria:Back", "num:count", "digits:+100 ذهب"]);
  });
});
