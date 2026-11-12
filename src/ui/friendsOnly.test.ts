/**
 * Online play is friends-only (the owner's decision: no strangers, ever).
 * The relay keeps Quick match off unless QUICK_MATCH=on (server/relay.ts,
 * server/relay.test.ts); this guard keeps every screen from reaching it.
 * The network layer (src/net) still speaks the "quick" message, because the
 * relay's developer-only queue and its tests use it, but nothing outside
 * src/net may call it, and no screen may offer it.
 */
import { describe, expect, it } from "vitest";
import ctxSource from "../app/ctx.ts?raw";
import lobbySource from "./screens/lobby.ts?raw";
import { failText } from "./screens/lobby";

/** Every app source outside the network layer and the tests (keys relative to src/ui). */
const sources = import.meta.glob<string>(["../**/*.ts", "!../**/*.test.ts", "!../net/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("friends-only online", () => {
  it("scans the app (main.ts, screens, the online glue)", () => {
    const keys = Object.keys(sources);
    for (const k of ["../main.ts", "./screens/lobby.ts", "./onlineOverlay.ts", "../match/online.ts", "./screens/home.ts"]) {
      expect(keys).toContain(k);
    }
  });

  it("no screen or app code starts a quick match", () => {
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      src.split("\n").forEach((line, i) => {
        if (/\.quick\s*\(/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("no screen offers Quick match, in either language", () => {
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      src.split("\n").forEach((line, i) => {
        if (/["'`]Quick match|["'`]Find a match|مباراة سريعة/i.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the lobby has no tabs and cannot be opened in a quick-match mode", () => {
    expect(ctxSource).not.toMatch(/\bquick\??\s*:/);
    expect(lobbySource).not.toMatch(/\bopts\.quick\b/);
    expect(lobbySource).not.toMatch(/value:\s*"quick"/);
  });

  it("tells a kid who typed too many wrong codes what to do", () => {
    // Node tests run the Golden Age edition, so these are the Arabic lines.
    // "A little while": a join is refused for up to ten minutes after wrong
    // codes, or for seconds after very fast repeats; the line fits both.
    expect(failText("rate-limited", "join")).toBe("رموز خاطئة كثيرة. انتظر قليلًا، ثم تأكّد من الرمز مع صديقك.");
    expect(lobbySource).toContain('"Too many wrong codes. Wait a little while, then check the code with your friend."');
    expect(failText("rate-limited", "create")).toBe("محاولات كثيرة. انتظر بضع ثوانٍ.");
    expect(failText("quick-disabled", "join")).toContain("مع الأصدقاء فقط");
  });
});
