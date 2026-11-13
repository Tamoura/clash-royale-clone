/**
 * The key registry stays complete: every 'cr-clone-' storage key written
 * in src (a string literal, or the fixed start of a template or of a
 * "prefix" + name join) must be listed in saveKeys.ts, and every listed key
 * must still be used somewhere (except the pre-registered round-2 names).
 * Comments are not code, so a key named in a comment does not count.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  PENDING_ROUND2_KEYS,
  PROGRESS_KEYS,
  SAVE_KEYS,
  isProgressKey,
  saveKeyDef,
  valueFits,
} from "./saveKeys";

const SRC = decodeURIComponent(new URL("../", import.meta.url).pathname);
const REGISTRY = `${SRC}meta/saveKeys.ts`;

/** Every non-test .ts file under src (TypeScript's own file system helpers; no Node types needed). */
function sourceFiles(dir: string): string[] {
  return ts.sys.readDirectory(dir, [".ts"]).filter((f) => !/\.test\.ts$|testkit\.ts$|\.d\.ts$/.test(f));
}

export interface FoundKey {
  /** The key, or the fixed start of a built key. */
  text: string;
  /** Built from a template or a join: only its start is known. */
  prefix: boolean;
  where: string;
}

/** Every 'cr-clone-' key literal and key prefix in one source file. */
export function findKeys(code: string, file = "x.ts"): FoundKey[] {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true);
  const out: FoundKey[] = [];
  const at = (n: ts.Node): string => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (n.text.startsWith("cr-clone-")) {
        // "cr-clone-x-" + id: the literal is only the start of the key.
        const joined = ts.isBinaryExpression(n.parent) && n.parent.left === n && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken;
        out.push({ text: n.text, prefix: joined, where: at(n) });
      }
    } else if (ts.isTemplateExpression(n) && n.head.text.startsWith("cr-clone-")) {
      out.push({ text: n.head.text, prefix: true, where: at(n) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Why a found key is not covered by the registry, or null when it is. */
function unregistered(f: FoundKey): string | null {
  const def = saveKeyDef(f.text);
  if (!f.prefix) return def ? null : `${f.text} (${f.where})`;
  // A built key is covered only by a registered prefix it starts with.
  return def?.prefix ? null : `${f.text}* (${f.where}): built keys need a prefix entry`;
}

describe("save key registry", () => {
  const files = sourceFiles(SRC).filter((f) => f !== REGISTRY);
  const found = files.flatMap((f) => findKeys(ts.sys.readFile(f) ?? "", f.replace(SRC, "src/")));

  it("scans the game's sources", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(found.some((f) => f.text === "cr-clone-trophies")).toBe(true);
  });

  it("every cr-clone- key in src is registered", () => {
    const missing = [...new Set(found.map(unregistered).filter((m): m is string => m !== null))];
    expect(missing, `register these in src/meta/saveKeys.ts (progress or device): ${missing.join(", ")}`).toEqual([]);
  });

  it("no registered key is stale", () => {
    const used = (d: (typeof SAVE_KEYS)[number]): boolean =>
      found.some((f) => (d.prefix ? f.text.startsWith(d.key) : f.text === d.key || (f.prefix && d.key.startsWith(f.text))));
    const stale = SAVE_KEYS.filter((d) => !PENDING_ROUND2_KEYS.has(d.key) && !used(d)).map((d) => d.key);
    expect(stale, `nothing uses these any more; remove them from saveKeys.ts: ${stale.join(", ")}`).toEqual([]);
  });

  it("keeps a round-2 key pending only until it lands", () => {
    const landed = [...PENDING_ROUND2_KEYS].filter((k) => found.some((f) => f.text === k));
    expect(
      landed,
      `now used in src; take them off PENDING_ROUND2_KEYS in saveKeys.ts so the stale check covers them: ${landed.join(", ")}`,
    ).toEqual([]);
  });

  it("lists each key once, all under cr-clone-", () => {
    const keys = SAVE_KEYS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^cr-clone-[a-z0-9-]+$/);
  });

  it("puts the game in the save and the device things outside it", () => {
    for (const k of ["cr-clone-trophies", "cr-clone-gold", "cr-clone-owned", "cr-clone-meta-v1", "cr-clone-pass", "cr-clone-arena-theme"]) {
      expect(isProgressKey(k), k).toBe(true);
    }
    for (const k of [
      "cr-clone-settings",
      "cr-clone-relay",
      "cr-clone-replay",
      "cr-clone-left-match",
      "cr-clone-lobby-tab",
      "cr-clone-splash-hold",
      "cr-clone-save-backup",
      "cr-clone-persist-asked",
      "cr-clone-home-tip-seen",
      // Round 2: the problem log, graphics memory and note, offline note.
      "cr-clone-problem-log",
      "cr-clone-gfx-memory",
      "cr-clone-gfx-note-seen",
      "cr-clone-offline-ready-seen",
      ...PENDING_ROUND2_KEYS,
    ]) {
      expect(isProgressKey(k), k).toBe(false);
      expect(saveKeyDef(k), k).toBeDefined();
    }
    expect(isProgressKey("cr-clone-unknown")).toBe(false);
    expect(PROGRESS_KEYS).toContain("cr-clone-deck-slots");
  });

  it("checks value shapes", () => {
    expect(valueFits("cr-clone-trophies", "420")).toBe(true);
    expect(valueFits("cr-clone-trophies", "lots")).toBe(false);
    expect(valueFits("cr-clone-owned", '["knight"]')).toBe(true);
    expect(valueFits("cr-clone-owned", "[knight")).toBe(false);
    expect(valueFits("cr-clone-arena-theme", "arabic")).toBe(true);
    expect(valueFits("cr-clone-arena-theme", "neon")).toBe(false);
    expect(valueFits("cr-clone-daily-done", "2026-11-13")).toBe(true);
    expect(valueFits("cr-clone-nope", "1")).toBe(false);
  });
});

describe("findKeys", () => {
  it("finds literals, template starts and joins, and skips comments", () => {
    const code = [
      "// 'cr-clone-in-a-comment' is not code",
      'const A = "cr-clone-alpha";',
      "const B = `cr-clone-beta`;",
      "const C = (id: string) => `cr-clone-gamma-${id}`;",
      'const D = (id: string) => "cr-clone-delta-" + id;',
      'const E = "not-cr-clone-x";',
    ].join("\n");
    expect(findKeys(code).map((f) => [f.text, f.prefix])).toEqual([
      ["cr-clone-alpha", false],
      ["cr-clone-beta", false],
      ["cr-clone-gamma-", true],
      ["cr-clone-delta-", true],
    ]);
  });
});
