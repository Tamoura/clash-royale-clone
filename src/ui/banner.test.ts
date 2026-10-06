import { describe, expect, it } from "vitest";
import { BANNER_MIN_MS, BANNER_SHOW_MS, BANNER_STALE_MS, BannerQueue } from "./banner";

describe("BannerQueue", () => {
  it("shows a banner at once when the slot is free", () => {
    const q = new BannerQueue();
    expect(q.push("Hello", {}, 0)).toBe("show");
    expect(q.current?.text).toBe("Hello");
    // Once its animation has run, the slot is free again.
    expect(q.push("Again", {}, BANNER_SHOW_MS + 1)).toBe("show");
  });

  it("makes lower and equal priorities wait, in priority order", () => {
    const q = new BannerQueue();
    q.push("phase", { priority: "phase" }, 0);
    expect(q.push("info 1", { priority: "info" }, 10)).toBe("queued");
    expect(q.push("tip", { priority: "tip" }, 20)).toBe("queued");
    expect(q.push("info 2", { priority: "info" }, 30)).toBe("queued");
    expect(q.push("phase 2", { priority: "phase" }, 40)).toBe("queued");
    expect(q.waiting.map((w) => w.text)).toEqual(["phase 2", "tip", "info 1", "info 2"]);
    // Nothing replaces the current banner before its minimum time.
    expect(q.poll(BANNER_MIN_MS - 1)).toBeNull();
    expect(q.nextPollAt(100)).toBe(BANNER_MIN_MS);
    expect(q.poll(BANNER_MIN_MS)?.text).toBe("phase 2");
    expect(q.poll(BANNER_MIN_MS + 10)).toBeNull();
    expect(q.poll(2 * BANNER_MIN_MS)?.text).toBe("tip");
    expect(q.poll(3 * BANNER_MIN_MS)?.text).toBe("info 1");
    expect(q.poll(4 * BANNER_MIN_MS)?.text).toBe("info 2");
    expect(q.poll(5 * BANNER_MIN_MS)).toBeNull();
    expect(q.nextPollAt(5 * BANNER_MIN_MS)).toBeNull();
  });

  it("lets a higher priority pre-empt what is showing", () => {
    const q = new BannerQueue();
    q.push("Tap a card", { priority: "tip" }, 0);
    expect(q.push("Last minute", { priority: "phase" }, 100)).toBe("show");
    expect(q.current?.text).toBe("Last minute");
    expect(q.push("3", { priority: "countdown", big: true }, 200)).toBe("show");
    // Countdown beats replace each other without waiting.
    expect(q.push("2", { priority: "countdown", big: true }, 300)).toBe("show");
    expect(q.current).toMatchObject({ text: "2", big: true });
    // The pre-empted tip is not resurrected; a lower one still waits.
    expect(q.push("info", {}, 400)).toBe("queued");
  });

  it("collapses duplicates of the showing or a waiting banner", () => {
    const q = new BannerQueue();
    q.push("OVERTIME!", { priority: "phase" }, 0);
    expect(q.push("OVERTIME!", { priority: "phase" }, 50)).toBe("dropped");
    expect(q.push("Keep spending", { priority: "tip" }, 60)).toBe("queued");
    expect(q.push("Keep spending", { priority: "tip" }, 70)).toBe("dropped");
    expect(q.waiting).toHaveLength(1);
    // A duplicate with a stronger claim upgrades the waiting entry.
    expect(q.push("Keep spending", { priority: "phase" }, 80)).toBe("dropped");
    expect(q.waiting[0].priority).toBe("phase");
  });

  it("drops tips that waited too long", () => {
    const q = new BannerQueue();
    q.push("phase", { priority: "phase" }, 0);
    q.push("stale tip", { priority: "tip" }, 10);
    q.push("A phase call", { priority: "phase" }, 20);
    expect(q.poll(BANNER_MIN_MS)?.text).toBe("A phase call");
    expect(q.poll(BANNER_STALE_MS + 100)).toBeNull();
    expect(q.waiting).toHaveLength(0);
  });

  it("clear() empties the slot and the queue", () => {
    const q = new BannerQueue();
    q.push("a", {}, 0);
    q.push("b", {}, 1);
    q.clear();
    expect(q.current).toBeNull();
    expect(q.waiting).toHaveLength(0);
  });
});

// Every banner the player reads must come through tr(): a raw string literal
// as the first argument of showBanner( would show English in the Islamic
// edition.
const sources = import.meta.glob<string>(["../**/*.ts", "!../**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("banner text is translated", () => {
  it("scans the whole src tree", () => {
    const keys = Object.keys(sources);
    expect(keys).toContain("../main.ts");
    expect(keys).toContain("./banner.ts");
    expect(keys.length).toBeGreaterThan(50);
  });

  it("never calls showBanner( with a raw string literal", () => {
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      src.split("\n").forEach((line, i) => {
        if (/showBanner\(\s*["'`]/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
      // Calls whose literal starts on the next line.
      for (const m of src.matchAll(/showBanner\(\s*\n\s*["'`]/g)) {
        offenders.push(`${file}: ${m[0].replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
