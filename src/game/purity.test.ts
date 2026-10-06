import { describe, expect, it } from "vitest";

/**
 * The sim must compute bit-identical results on every JS engine, or
 * lockstep peers (an iPhone and an Android) drift apart. IEEE-754 pins
 * + - * / and sqrt exactly, but transcendental functions, hypot and pow
 * may round differently per engine, and clocks/unseeded randomness are
 * never reproducible. A line may opt out with a trailing `// purity-allow`.
 */
const IMPURE = /Math\.(hypot|sin|cos|tan|atan2|exp|log|pow|cbrt|random)\b|Date\.now|performance\.now/;

/** Offending "file:line: text" entries in one source. */
export function impureLines(file: string, source: string): string[] {
  const out: string[] = [];
  source.split("\n").forEach((line, i) => {
    if (IMPURE.test(line) && !/\/\/ purity-allow\s*$/.test(line)) {
      out.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  });
  return out;
}

describe("sim purity", () => {
  it("src/game uses only engine-exact math", () => {
    // Every non-test module in this folder, read as raw source text.
    const sources = import.meta.glob<string>(["./*.ts", "!./*.test.ts"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(5);
    const bad = files.flatMap(([file, src]) => impureLines(file, src));
    expect(bad).toEqual([]);
  });

  it("flags hypot, trig and clocks but honours purity-allow", () => {
    expect(impureLines("x.ts", "const d = Math.hypot(dx, dy);")).toHaveLength(1);
    expect(impureLines("x.ts", "a = Math.cos(t) + Math.sin(t);")).toHaveLength(1);
    expect(impureLines("x.ts", "const t = performance.now();")).toHaveLength(1);
    expect(impureLines("x.ts", "const r = Math.random(); // purity-allow")).toHaveLength(0);
    expect(impureLines("x.ts", "const d = Math.sqrt(dx * dx + dy * dy);")).toHaveLength(0);
  });
});
