/**
 * Emoji render differently on every device (or not at all), so UI chrome
 * uses the drawn icons in icons.ts instead. This ratchet counts emoji per
 * file and fails when a file gains any: lower noEmoji.baseline.json as
 * screens move to icons, never raise it. Files missing from the baseline
 * are allowed none. The in-battle emote list is exempt (emotes ARE emoji).
 */
import { describe, expect, it } from "vitest";
import baseline from "./noEmoji.baseline.json";

const EMOJI = /\p{Extended_Pictographic}/gu;
/** Lines exempt from the count. */
const ALLOW = /\bEMOTES\s*=\s*\[/;

const sources = import.meta.glob<string>(
  ["../main.ts", "../render3d/hud.ts", "./**/*.ts", "!./**/*.test.ts"],
  { query: "?raw", import: "default", eager: true },
);

/** "./x.ts" / "../main.ts" (relative to src/ui) -> "src/ui/x.ts" / "src/main.ts". */
function repoPath(key: string): string {
  return key.startsWith("./") ? `src/ui/${key.slice(2)}` : `src/${key.slice(3)}`;
}

export function emojiCount(source: string): number {
  let n = 0;
  for (const line of source.split("\n")) {
    if (!ALLOW.test(line)) n += line.match(EMOJI)?.length ?? 0;
  }
  return n;
}

function counts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, src] of Object.entries(sources)) {
    const n = emojiCount(src);
    if (n > 0) out[repoPath(key)] = n;
  }
  return out;
}

describe("no new emoji in UI code", () => {
  it("scans the UI sources", () => {
    expect(Object.keys(sources)).toContain("../main.ts");
    expect(Object.keys(sources)).toContain("../render3d/hud.ts");
  });

  it("no file exceeds its baseline count", () => {
    const limits = baseline as Record<string, number>;
    const over = Object.entries(counts())
      .filter(([file, n]) => n > (limits[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} emoji (baseline ${limits[file] ?? 0})`);
    expect(over).toEqual([]);
  });

  it("counts emoji but skips the emote list", () => {
    expect(emojiCount('const s = "Win 🏆 now ⚔️";')).toBe(2);
    expect(emojiCount('const EMOTES = ["😂", "😭"];')).toBe(0);
    expect(emojiCount("plain text, 100% (ok)")).toBe(0);
  });
});
