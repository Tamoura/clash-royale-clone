import { describe, expect, it } from "vitest";
import { sanitizePrefs } from "../ui/prefs";
import { memoryKV } from "./kv";
import { loadProfile, saveProfile } from "./progress";
import {
  CODE_MAX_CHARS,
  SAVE_BACKUP_KEY,
  SAVE_FORMAT,
  applySave,
  checkChar,
  checkOk,
  decodeSave,
  encodeSave,
  fromBase64Url,
  gatherSave,
  readBackup,
  readSaveJson,
  saveFileName,
  saveJson,
  storedProgressKeys,
  summarize,
  toBase64Url,
  undoLastLoad,
  type SaveData,
  type SaveStore,
} from "./saveCode";

/** A localStorage stand-in with removeItem, length and key(). */
function store(seed: Record<string, string> = {}): SaveStore & { data: Record<string, string> } {
  const kv = memoryKV(seed);
  return {
    data: kv.data,
    getItem: kv.getItem,
    setItem: kv.setItem,
    removeItem: (k) => {
      delete kv.data[k];
    },
    get length() {
      return Object.keys(kv.data).length;
    },
    key: (i) => Object.keys(kv.data)[i] ?? null,
  };
}

/** A device that has played: progress written by the game's own writer, plus device keys. */
function playedDevice(trophies = 640, gold = 1234): SaveStore & { data: Record<string, string> } {
  const s = store({
    "cr-clone-settings": JSON.stringify({ v: 1, master: 0.3, quality: "low", textScale: 1.3, playerName: "Zaid", crest: 5 }),
    "cr-clone-relay": "wss://example.test/relay",
    "cr-clone-replay": JSON.stringify({ tape: [1, 2, 3] }),
    "cr-clone-arena-theme": "arabic",
    "cr-clone-tutored": "1",
    "cr-clone-pass": JSON.stringify({ season: "2026-11", xp: 40, claimed: [1] }),
  });
  const p = loadProfile(s);
  saveProfile(s, { ...p, trophies, gold, gems: 77, owned: [...p.owned, "balloon", "witch"] });
  return s;
}

const LEFT_ALONE = ["cr-clone-relay", "cr-clone-replay"];

describe("check character", () => {
  it("catches every single wrong character", () => {
    const body = "CR1Zabc-_XYZ0123";
    const code = body + checkChar(body);
    expect(checkOk(code)).toBe(true);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let i = 0; i < code.length; i++) {
      for (const c of alphabet) {
        if (c === code[i]) continue;
        const typo = code.slice(0, i) + c + code.slice(i + 1);
        expect(checkOk(typo), typo).toBe(false);
      }
    }
  });

  it("catches a missing character", () => {
    const body = "CR1Pqwerty";
    const code = body + checkChar(body);
    for (let i = 0; i < code.length; i++) expect(checkOk(code.slice(0, i) + code.slice(i + 1))).toBe(false);
  });
});

describe("base64url", () => {
  it("round trips every length", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
      const text = toBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect([...fromBase64Url(text)!]).toEqual([...bytes]);
    }
  });

  it("refuses characters outside the alphabet", () => {
    expect(fromBase64Url("ab+c")).toBeNull();
    expect(fromBase64Url("abcde")).toBeNull();
  });
});

describe("save codes", () => {
  it("round trips a played device, packed and plain", async () => {
    const a = playedDevice();
    const data = gatherSave(a, 1_700_000_000_000);
    for (const compress of [true, false]) {
      const code = await encodeSave(data, { compress });
      expect(code.startsWith(`CR${SAVE_FORMAT}${compress ? "Z" : "P"}`)).toBe(true);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      const back = await decodeSave(code);
      expect(back.ok).toBe(true);
      if (!back.ok) return;
      expect(back.data).toEqual(data);
      expect(back.dropped).toEqual([]);
    }
  });

  it("packs smaller than plain", async () => {
    const data = gatherSave(playedDevice());
    const z = await encodeSave(data);
    const p = await encodeSave(data, { compress: false });
    expect(z.length).toBeLessThan(p.length);
  });

  it("carries progress, the edition and who, never device keys", () => {
    const data = gatherSave(playedDevice());
    expect(data.keys["cr-clone-trophies"]).toBe("640");
    expect(data.keys["cr-clone-meta-v1"]).toBe("1");
    expect(data.keys["cr-clone-arena-theme"]).toBe("arabic");
    expect(data.keys["cr-clone-pass"]).toContain("2026-11");
    for (const k of [...LEFT_ALONE, "cr-clone-settings"]) expect(data.keys[k]).toBeUndefined();
    expect(data.who).toEqual({ name: "Zaid", crest: 5 });
  });

  it("forgives spaces and line breaks", async () => {
    const code = await encodeSave(gatherSave(playedDevice()));
    const wrapped = `  ${code.slice(0, 30)}\n${code.slice(30, 61)}\r\n ${code.slice(61)}\n`;
    expect((await decodeSave(wrapped)).ok).toBe(true);
  });

  it("catches a typo before reading anything", async () => {
    const code = await encodeSave(gatherSave(playedDevice()));
    const i = Math.floor(code.length / 2);
    const typo = code.slice(0, i) + (code[i] === "A" ? "B" : "A") + code.slice(i + 1);
    expect(await decodeSave(typo)).toEqual({ ok: false, reason: "typo" });
    expect(await decodeSave(code.slice(0, -5))).toEqual({ ok: false, reason: "typo" });
  });

  it("refuses another game's save", async () => {
    const json = JSON.stringify({ g: "other-game", v: 1, t: 0, k: { "cr-clone-trophies": "9" } });
    const body = "CR1P" + toBase64Url(new TextEncoder().encode(json));
    expect(await decodeSave(body + checkChar(body))).toEqual({ ok: false, reason: "wrong-game" });
  });

  it("politely refuses a newer format (the header or the JSON)", async () => {
    const newer = "CR2Zabcdef";
    expect(await decodeSave(newer + checkChar(newer))).toEqual({ ok: false, reason: "newer" });
    const json = JSON.stringify({ g: "crown-rush", v: SAVE_FORMAT + 1, t: 0, k: { "cr-clone-trophies": "9" } });
    const body = "CR1P" + toBase64Url(new TextEncoder().encode(json));
    expect(await decodeSave(body + checkChar(body))).toEqual({ ok: false, reason: "newer" });
  });

  it("says what kind of wrong a pasted thing is", async () => {
    expect(await decodeSave("")).toEqual({ ok: false, reason: "empty" });
    expect(await decodeSave("  \n ")).toEqual({ ok: false, reason: "empty" });
    expect(await decodeSave("hello there, this is not a code")).toEqual({ ok: false, reason: "not-a-code" });
    expect(await decodeSave("{\"g\":\"crown-rush\"}")).toEqual({ ok: false, reason: "not-a-code" });
    expect(await decodeSave("K7Q2-M9XA-3FB1")).toEqual({ ok: false, reason: "deck-code" });
    expect(await decodeSave("x".repeat(CODE_MAX_CHARS + 1))).toEqual({ ok: false, reason: "too-big" });
    expect(await decodeSave("C".repeat(CODE_MAX_CHARS * 2 + 1))).toEqual({ ok: false, reason: "too-big" });
  });

  it("calls garbage with a good check character damaged", async () => {
    for (const body of ["CR1Zzzzzzzzzzzzzzzzz", "CR1P" + toBase64Url(new TextEncoder().encode("not json")), "CR1Qabcd"]) {
      expect(await decodeSave(body + checkChar(body))).toEqual({ ok: false, reason: "damaged" });
    }
  });

  it("stops a code that unpacks into something huge", async () => {
    const big = { at: 0, keys: { "cr-clone-quests": JSON.stringify({ pad: "a".repeat(1_100_000) }) } };
    const code = await encodeSave(big);
    expect(code.length).toBeLessThan(CODE_MAX_CHARS);
    expect(await decodeSave(code)).toEqual({ ok: false, reason: "too-big" });
  });
});

describe("reading a save safely", () => {
  it("keeps only registered progress keys with values that fit", () => {
    const r = readSaveJson({
      g: "crown-rush",
      v: 1,
      t: 5,
      k: {
        "cr-clone-trophies": "300",
        "cr-clone-gold": "lots", // not a number
        "cr-clone-owned": "[broken", // not JSON
        "cr-clone-settings": "{}", // device
        "cr-clone-relay": "wss://evil.test", // device
        "cr-clone-made-up": "1", // unknown
        "cr-clone-quests": { not: "a string" },
        "cr-clone-achievements": "x".repeat(200_000), // too long
        "cr-clone-arena-theme": "neon", // not an edition
        __proto__: "1",
      },
      w: { n: "<b>Rim</b>!!", c: 99 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.keys).toEqual({ "cr-clone-trophies": "300" });
    expect(r.dropped.sort()).toEqual(
      [
        "cr-clone-achievements",
        "cr-clone-arena-theme",
        "cr-clone-gold",
        "cr-clone-made-up",
        "cr-clone-owned",
        "cr-clone-quests",
        "cr-clone-relay",
        "cr-clone-settings",
      ].sort(),
    );
    expect(r.data.who).toEqual({ name: "bRimb", crest: 0 });
  });

  it("refuses a save with nothing usable in it", () => {
    expect(readSaveJson({ g: "crown-rush", v: 1, k: { "cr-clone-relay": "x" } })).toEqual({ ok: false, reason: "empty-save" });
    expect(readSaveJson({ g: "crown-rush", v: 1, k: [] })).toEqual({ ok: false, reason: "damaged" });
    expect(readSaveJson({ g: "crown-rush", v: "1", k: {} })).toEqual({ ok: false, reason: "damaged" });
    expect(readSaveJson(null)).toEqual({ ok: false, reason: "damaged" });
  });
});

describe("loading onto a device, with a backup and undo", () => {
  it("replaces progress, keeps device keys, and backs up first", async () => {
    const a = playedDevice(910, 5000);
    const code = await encodeSave(gatherSave(a));
    const b = store({
      "cr-clone-settings": JSON.stringify({ v: 1, master: 0.9, quality: "high", textScale: 1.15, playerName: "Mira", crest: 2 }),
      "cr-clone-relay": "ws://localhost:3000",
      "cr-clone-replay": "{\"tape\":[9]}",
      "cr-clone-arena-theme": "normal",
      "cr-clone-streak": "{\"wins\":2,\"losses\":0}", // B only: removed by the load
    });
    saveProfile(b, { ...loadProfile(b), trophies: 120, gold: 80 });
    const before = { ...b.data };

    const dec = await decodeSave(code);
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(applySave(b, dec.data, 42)).toEqual({ ok: true });

    // The game reads A's progress after the reload.
    const p = loadProfile(b);
    expect(p.trophies).toBe(910);
    expect(p.gold).toBe(5000);
    expect(p.owned).toContain("balloon");
    expect(b.data["cr-clone-arena-theme"]).toBe("arabic");
    expect(b.data["cr-clone-streak"]).toBeUndefined();
    // Device keys untouched; settings keep their values, only name and crest move.
    for (const k of LEFT_ALONE) expect(b.data[k]).toBe(before[k]);
    const s = JSON.parse(b.data["cr-clone-settings"]);
    expect(s).toMatchObject({ master: 0.9, quality: "high", textScale: 1.15, playerName: "Zaid", crest: 5 });

    // The backup holds B as it was.
    const backup = readBackup(b);
    expect(backup?.at).toBe(42);
    expect(backup?.keys["cr-clone-trophies"]).toBe("120");
    expect(backup?.who).toEqual({ name: "Mira", crest: 2 });

    // Undo puts B back exactly and forgets the backup.
    // (The settings blob comes back with the same values, written out in full.)
    expect(undoLastLoad(b)).toEqual({ ok: true });
    const { "cr-clone-settings": settingsNow, ...restNow } = b.data;
    const { "cr-clone-settings": settingsBefore, ...restBefore } = before;
    expect(restNow).toEqual(restBefore);
    expect(sanitizePrefs(JSON.parse(settingsNow))).toEqual(sanitizePrefs(JSON.parse(settingsBefore)));
    expect(readBackup(b)).toBeNull();
    expect(undoLastLoad(b)).toEqual({ ok: false, reason: "no-backup" });
  });

  it("leaves the edition alone when the save has none", () => {
    const b = store({ "cr-clone-arena-theme": "arabic", "cr-clone-trophies": "5" });
    const data: SaveData = { at: 1, keys: { "cr-clone-trophies": "50" } };
    expect(applySave(b, data)).toEqual({ ok: true });
    expect(b.data["cr-clone-arena-theme"]).toBe("arabic");
    expect(b.data["cr-clone-trophies"]).toBe("50");
  });

  it("changes nothing when the backup cannot be written", () => {
    const b = store({ "cr-clone-trophies": "5" });
    const full: SaveStore = {
      ...b,
      getItem: b.getItem,
      removeItem: b.removeItem,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(applySave(full, { at: 1, keys: { "cr-clone-trophies": "50" } })).toEqual({ ok: false, reason: "storage" });
    expect(b.data).toEqual({ "cr-clone-trophies": "5" });
  });

  it("puts this device back when storage fills up half way", () => {
    const b = store({ "cr-clone-trophies": "5", "cr-clone-gold": "10" });
    let writes = 0;
    const flaky: SaveStore = {
      getItem: b.getItem,
      removeItem: b.removeItem,
      setItem: (k, v) => {
        writes++;
        if (writes === 3) throw new Error("QuotaExceededError"); // backup, trophies, then gold fails
        b.setItem(k, v);
      },
    };
    const r = applySave(flaky, { at: 1, keys: { "cr-clone-trophies": "50", "cr-clone-gold": "999" } });
    expect(r).toEqual({ ok: false, reason: "storage" });
    expect(b.data["cr-clone-trophies"]).toBe("5");
    expect(b.data["cr-clone-gold"]).toBe("10");
    expect(b.data[SAVE_BACKUP_KEY]).toBeDefined();
  });

  it("lists only progress keys that are stored", () => {
    const s = store({ "cr-clone-trophies": "1", "cr-clone-settings": "{}", other: "x" });
    expect(storedProgressKeys(s)).toEqual(["cr-clone-trophies"]);
  });
});

describe("summary for the confirm screen", () => {
  it("reads trophies, arena, cards, gold and gems the way the game will", () => {
    const sum = summarize(gatherSave(playedDevice(640, 1234)));
    expect(sum.trophies).toBe(640);
    expect(sum.arena).toBeGreaterThan(0);
    expect(sum.gold).toBe(1234);
    expect(sum.gems).toBe(77);
    expect(sum.cards).toBe(loadProfile(playedDevice()).owned.length);
    expect(sum.name).toBe("Zaid");
    expect(sum.edition).toBe("arabic");
  });

  it("shows a fresh device as a fresh profile", () => {
    const sum = summarize({ keys: {} });
    expect(sum.trophies).toBe(0);
    expect(sum.arena).toBe(0);
    expect(sum.cards).toBeGreaterThanOrEqual(8);
    expect(sum.edition).toBeNull();
  });

  it("names the file by date", () => {
    expect(saveFileName(new Date(2026, 10, 3))).toBe("crown-rush-save-2026-11-03.txt");
  });

  it("writes the game name and format into the JSON", () => {
    const json = JSON.parse(saveJson({ at: 7, keys: { "cr-clone-gold": "1" } }));
    expect(json).toEqual({ g: "crown-rush", v: SAVE_FORMAT, t: 7, k: { "cr-clone-gold": "1" } });
  });
});
