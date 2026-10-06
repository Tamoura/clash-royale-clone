import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PrefsModule = typeof import("./prefs");

/** A Map-backed Storage stand-in (vitest runs in node, without localStorage). */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const throwing: Storage = {
  length: 0,
  clear() {},
  key: () => null,
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
  removeItem() {
    throw new Error("SecurityError");
  },
};

/** Fresh module instance, so the in-memory cache starts empty. */
async function fresh(store: Storage | undefined): Promise<PrefsModule> {
  vi.stubGlobal("localStorage", store);
  vi.resetModules();
  return import("./prefs");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefs", () => {
  it("starts from the documented defaults", async () => {
    const p = await fresh(memoryStorage());
    expect(p.getPrefs()).toEqual({
      v: 1,
      master: 1,
      music: 0.5,
      sfx: 0.8,
      muted: false,
      haptics: true,
      reduceMotion: "auto",
      quality: "auto",
      teamPalette: "default",
      textScale: 1,
      playerName: "",
      crest: 0,
    });
  });

  it("round-trips through storage", async () => {
    const store = memoryStorage();
    const a = await fresh(store);
    a.setPrefs({ music: 0.2, muted: true, quality: "low", teamPalette: "cb", textScale: 1.3, crest: 7 });
    expect(JSON.parse(store.getItem(a.PREFS_KEY)!)).toMatchObject({ music: 0.2, muted: true, crest: 7 });
    const b = await fresh(store);
    expect(b.getPrefs()).toMatchObject({
      music: 0.2,
      muted: true,
      quality: "low",
      teamPalette: "cb",
      textScale: 1.3,
      crest: 7,
      sfx: 0.8, // untouched keys keep their defaults
    });
  });

  it("sanitises patches and corrupt stored blobs", async () => {
    const p = await fresh(
      memoryStorage({
        "cr-clone-settings": JSON.stringify({ master: 4, sfx: "loud", quality: "ultra", crest: 99, textScale: 2 }),
      }),
    );
    expect(p.getPrefs()).toMatchObject({ master: 1, sfx: 0.8, quality: "auto", crest: 0, textScale: 1 });
    p.setPrefs({ music: -1, crest: 3.5 as number, reduceMotion: "sometimes" as never });
    expect(p.getPrefs()).toMatchObject({ music: 0, crest: 0, reduceMotion: "auto" });
    const garbage = await fresh(memoryStorage({ "cr-clone-settings": "{not json" }));
    expect(garbage.getPrefs()).toEqual(garbage.DEFAULT_PREFS);
  });

  it("cleans player names: letters, digits, space, _ and -, max 12", async () => {
    const p = await fresh(memoryStorage());
    expect(p.sanitizePlayerName("  Ali<script>  ")).toBe("Aliscript");
    expect(p.sanitizePlayerName("Zed_99 - pro!!")).toBe("Zed_99 - pro");
    expect(p.sanitizePlayerName("abcdefghijklmnop")).toBe("abcdefghijkl");
    expect(p.sanitizePlayerName("محمد ١٢٣")).toBe("محمد ١٢٣");
    expect(p.sanitizePlayerName("a\u{1F600}b")).toBe("ab");
    expect(p.sanitizePlayerName(42)).toBe("");
    p.setPrefs({ playerName: "  <b>Nour</b> " });
    expect(p.getPrefs().playerName).toBe("bNourb");
  });

  it("notifies subscribers until they unsubscribe", async () => {
    const p = await fresh(memoryStorage());
    const seen: number[] = [];
    const off = p.onPrefs((prefs) => seen.push(prefs.sfx));
    p.setPrefs({ sfx: 0.3 });
    off();
    p.setPrefs({ sfx: 0.4 });
    expect(seen).toEqual([0.3]);
  });

  it("survives a storage that throws on every call", async () => {
    const p = await fresh(throwing);
    expect(p.getPrefs()).toEqual(p.DEFAULT_PREFS);
    expect(() => p.setPrefs({ muted: true })).not.toThrow();
    expect(p.getPrefs().muted).toBe(true); // kept in memory for the session
  });

  it("works with no storage at all", async () => {
    const p = await fresh(undefined);
    expect(p.setPrefs({ haptics: false }).haptics).toBe(false);
  });

  it("reducedMotion follows the pref, and the OS when set to auto", async () => {
    const p = await fresh(memoryStorage());
    let osReduce = true;
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") && osReduce }));
    expect(p.reducedMotion()).toBe(true);
    osReduce = false;
    expect(p.reducedMotion()).toBe(false);
    p.setPrefs({ reduceMotion: "on" });
    expect(p.reducedMotion()).toBe(true);
    osReduce = true;
    p.setPrefs({ reduceMotion: "off" });
    expect(p.reducedMotion()).toBe(false);
  });

  it("reducedMotion is false on 'auto' without matchMedia", async () => {
    const p = await fresh(memoryStorage());
    expect(p.reducedMotion()).toBe(false);
  });
});
