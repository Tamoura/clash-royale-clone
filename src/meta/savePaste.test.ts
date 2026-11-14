/**
 * Save codes as people really paste them: out of a chat, an email or an
 * Arabic document, with words, quotes, line breaks and invisible marks
 * around and inside them. Every case is built from a real encoded save
 * (both packings), and a case loads only when it gives back exactly that save.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  CODE_MAX_CHARS,
  FIND_LIMITS,
  checkChar,
  cleanPasted,
  decodeSave,
  encodeSave,
  type DecodeResult,
  type SaveData,
  type SaveError,
} from "./saveCode";

const DECK = ["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"];

/** A profile shaped like a real one (the keys a browser save holds after a few battles). */
function profile(at: number, trophies: number, gold: number, owned: string[]): SaveData {
  const slot = { name: "", cards: DECK };
  return {
    at,
    keys: {
      "cr-clone-trophies": String(trophies),
      "cr-clone-gold": String(gold),
      "cr-clone-gems": "35",
      "cr-clone-levels": JSON.stringify({ knight: 2, archers: 2 }),
      "cr-clone-owned": JSON.stringify([...DECK, "skeletons", ...owned]),
      "cr-clone-shards": JSON.stringify({ knight: 3, arrows: 4, giant: 1 }),
      "cr-clone-chests": JSON.stringify([null, null, null, null]),
      "cr-clone-deck": JSON.stringify(DECK),
      "cr-clone-meta-v1": "1",
      "cr-clone-deck-slots": JSON.stringify({ v: 1, active: 0, slots: [slot, slot, slot] }),
      "cr-clone-pass": JSON.stringify({ key: "2026-11", crowns: 7, claimed: [1, 2], archive: [] }),
      "cr-clone-season": JSON.stringify({ key: "2026-11", best: trophies, history: [] }),
      "cr-clone-chests-earned": "4",
      "cr-clone-free-chest-at": String(at + 14_400_000),
      "cr-clone-legendary-pity": "3",
      "cr-clone-tutorial": "done",
      "cr-clone-tutored": "1",
      "cr-clone-newcards-seen": "1",
      "cr-clone-arena-theme": "arabic",
    },
    who: { name: "Zaid", crest: 5 },
  };
}

const NEW_AT = Date.UTC(2026, 10, 13, 16, 54);
const NEW = profile(NEW_AT, 1460, 5231, ["balloon", "witch"]);
const OLD = profile(NEW_AT - 3 * 86_400_000, 640, 146, []);
/** A different save made at the same moment as NEW (a tie goes to the last one in the text). */
const TWIN = profile(NEW_AT, 920, 777, ["witch"]);

type Packing = "Z" | "P";
const codes: Record<Packing, { NEW: string; OLD: string; TWIN: string }> = {} as never;

beforeAll(async () => {
  for (const compress of [true, false]) {
    codes[compress ? "Z" : "P"] = {
      NEW: await encodeSave(NEW, { compress }),
      OLD: await encodeSave(OLD, { compress }),
      TWIN: await encodeSave(TWIN, { compress }),
    };
  }
});

// ---- Ways text gets bent on its way between two tablets ------------------------------------------

/** Lines of `width` characters, joined by `sep`. */
function wrap(code: string, width: number, sep: string): string {
  const lines: string[] = [];
  for (let i = 0; i < code.length; i += width) lines.push(code.slice(i, i + width));
  return lines.join(sep);
}

/** `mark` slipped in after every `n` characters. */
function sprinkle(code: string, n: number, marks: string[]): string {
  let out = "";
  for (let i = 0; i < code.length; i += n) out += code.slice(i, i + n) + (i + n < code.length ? marks[(i / n) % marks.length] : "");
  return out;
}

const fullwidth = (s: string): string => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
const arabicDigits = (s: string, base: number): string => s.replace(/[0-9]/g, (d) => String.fromCharCode(base + Number(d)));
const DASH_LOOKALIKES = ["\u2010", "\u2011", "\u2012", "\u2013", "\u2212", "\ufe63", "\uff0d"];
const dashes = (s: string): string => {
  let i = 0;
  return s.replace(/-/g, () => DASH_LOOKALIKES[i++ % DASH_LOOKALIKES.length]);
};

/** One character changed in the middle. */
function typo(code: string, at = Math.floor(code.length / 2)): string {
  return code.slice(0, at) + (code[at] === "A" ? "B" : "A") + code.slice(at + 1);
}

/** A code from a newer game: a higher format digit, with a right check character. */
function newerCode(code: string): string {
  const body = "CR2" + code.slice(3, -1);
  return body + checkChar(body);
}

interface Case {
  name: string;
  text: (c: { NEW: string; OLD: string; TWIN: string }) => string;
  /** "NEW", "OLD" or "TWIN": that save loads. Otherwise the reason it does not. */
  want: "NEW" | "TWIN" | SaveError;
}

const LOADS: Case[] = [
  // Chat copies
  { name: "WhatsApp Android copy", text: (c) => `[13/11/2026, 4:54 pm] Dad: ${c.NEW}`, want: "NEW" },
  { name: "WhatsApp iOS copy", text: (c) => `\u200e[13/11/2026, 16:54:12] Mum: ${c.NEW}`, want: "NEW" },
  {
    name: "WhatsApp, several messages",
    text: (c) => `[13/11/2026, 16:52] Dad: Here's the save code for the big tablet\n[13/11/2026, 16:54] Dad: ${c.NEW}\n[13/11/2026, 16:55] Zaid: thank you!!`,
    want: "NEW",
  },
  { name: "iMessage with words", text: (c) => `Here's my save code: ${c.NEW} thanks!`, want: "NEW" },
  { name: "words after on the same line", text: (c) => `${c.NEW} this is the one from the big tablet`, want: "NEW" },
  {
    name: "Telegram copy",
    text: (c) => `Dad, [13.11.26 16:54]\nHere is the save code \u{1F447}\n${c.NEW}\n\nDad, [13.11.26 16:55]\nload it in Settings`,
    want: "NEW",
  },
  // Invisible marks
  { name: "Arabic sentence, RLM, ALM and an isolate", text: (c) => `هذا رمز الحفظ\u200f: \u2068${c.NEW}\u2069\u200f شكرًا؜!`, want: "NEW" },
  {
    name: "Arabic WhatsApp line with isolates",
    text: (c) => `\u200f[13/11/2026, 16:54] أبي: \u2067خذ الرمز\u2069 \u2066${c.NEW}\u2069 \u200fاحفظه في الإعدادات`,
    want: "NEW",
  },
  { name: "LRM marks around", text: (c) => `\u200e${c.NEW}\u200e`, want: "NEW" },
  { name: "RLE ... PDF embedding", text: (c) => `\u202b${c.NEW}\u202c`, want: "NEW" },
  { name: "LRE and RLO overrides", text: (c) => `\u202a\u202e${c.NEW}\u202c\u202c ok`, want: "NEW" },
  { name: "soft hyphens inside", text: (c) => sprinkle(c.NEW, 20, ["\u00ad"]), want: "NEW" },
  { name: "zero-width spaces and joiners inside", text: (c) => sprinkle(c.NEW, 37, ["\u200b", "\u2060", "\ufeff", "\u200c", "\u200d"]), want: "NEW" },
  {
    name: "invisible operators, Mongolian vowel separator, variation selectors inside",
    text: (c) => sprinkle(c.NEW, 29, ["\u2061", "\u2062", "\u2063", "\u2064", "\u180e", "\ufe0f", "\ufe0e"]),
    want: "NEW",
  },
  { name: "LRM between every character", text: (c) => [...c.NEW].join("\u200e"), want: "NEW" },
  // Wrapping
  { name: "76-character lines with CRLF", text: (c) => wrap(c.NEW, 76, "\r\n"), want: "NEW" },
  {
    name: "Gmail quoted reply",
    text: (c) =>
      `On Fri, 13 Nov 2026 at 16:54, Dad <dad@example.com> wrote:\r\n> Here is the save code:\r\n> ${wrap(c.NEW, 72, "\r\n> ")}\r\n>\r\n> Love, Dad\r\n`,
    want: "NEW",
  },
  { name: "nested quote marks", text: (c) => `> > ${wrap(c.NEW, 70, "\n> > ")}\n> > see you`, want: "NEW" },
  { name: "wrapped after a header on the same line", text: (c) => `Code: ${c.NEW.slice(0, 60)}\n${wrap(c.NEW.slice(60), 76, "\n")}\nThanks`, want: "NEW" },
  { name: "a space in the middle", text: (c) => `${c.NEW.slice(0, 333)} ${c.NEW.slice(333)}`, want: "NEW" },
  // Around the code
  { name: "curly quotes", text: (c) => `“${c.NEW}”`, want: "NEW" },
  { name: "guillemets", text: (c) => `«${c.NEW}»`, want: "NEW" },
  { name: "single curly quotes", text: (c) => `‘${c.NEW}’`, want: "NEW" },
  { name: "straight quotes", text: (c) => `"${c.NEW}"`, want: "NEW" },
  { name: "single straight quotes", text: (c) => `'${c.NEW}'`, want: "NEW" },
  { name: "backticks", text: (c) => `\`${c.NEW}\``, want: "NEW" },
  { name: "code fence", text: (c) => "```\n" + c.NEW + "\n```", want: "NEW" },
  { name: "angle brackets", text: (c) => `<${c.NEW}>`, want: "NEW" },
  { name: "parentheses", text: (c) => `(${c.NEW})`, want: "NEW" },
  { name: "square brackets", text: (c) => `[${c.NEW}]`, want: "NEW" },
  { name: "full stop after", text: (c) => `${c.NEW}.`, want: "NEW" },
  { name: "exclamation mark after", text: (c) => `${c.NEW}!`, want: "NEW" },
  { name: "Arabic question mark after", text: (c) => `${c.NEW}؟`, want: "NEW" },
  { name: "Arabic comma after", text: (c) => `${c.NEW}، شكرًا`, want: "NEW" },
  // Look-alike characters
  { name: "NBSP around", text: (c) => `\u00a0${c.NEW}\u00a0`, want: "NEW" },
  { name: "thin spaces around", text: (c) => `code:\u2009${c.NEW}\u2009thanks`, want: "NEW" },
  { name: "ideographic spaces around", text: (c) => `\u3000${c.NEW}\u3000`, want: "NEW" },
  { name: "NBSP and narrow NBSP inside", text: (c) => sprinkle(c.NEW, 50, ["\u00a0", "\u202f", "\u2009"]), want: "NEW" },
  { name: "fullwidth copy", text: (c) => fullwidth(c.NEW), want: "NEW" },
  { name: "dash look-alikes for -", text: (c) => dashes(c.NEW), want: "NEW" },
  { name: "Arabic-Indic digits", text: (c) => arabicDigits(c.NEW, 0x660), want: "NEW" },
  { name: "Eastern Arabic-Indic digits", text: (c) => arabicDigits(c.NEW, 0x6f0), want: "NEW" },
  // The save file
  { name: "save file with BOM and CRLF", text: (c) => `\ufeff${c.NEW}\r\n`, want: "NEW" },
  { name: "save file with a trailing newline", text: (c) => `${c.NEW}\n`, want: "NEW" },
  // Words glued on
  { name: "a word glued onto the end", text: (c) => `${c.NEW}thanks`, want: "NEW" },
  { name: "a word glued on, then more words", text: (c) => `${c.NEW}Thanks so much dad`, want: "NEW" },
  { name: "glued at both ends", text: (c) => `savecode:${c.NEW}ok`, want: "NEW" },
  { name: "a word glued onto the start", text: (c) => `code${c.NEW} ok`, want: "NEW" },
  { name: "Arabic words glued at both ends", text: (c) => `الرمز${c.NEW}شكرًا`, want: "NEW" },
  { name: "wrapped, with a word glued onto the end", text: (c) => `${wrap(c.NEW, 76, "\n")}cheers\nDad`, want: "NEW" },
  // Two codes
  { name: "two codes: old then new", text: (c) => `old one: ${c.OLD}\nnew one: ${c.NEW}`, want: "NEW" },
  { name: "two codes: new then old", text: (c) => `new one: ${c.NEW}\nold one: ${c.OLD}`, want: "NEW" },
  {
    name: "a whole chat with an old and a new code",
    text: (c) =>
      `[10/11/2026, 09:12] Dad: ${c.OLD}\n[10/11/2026, 09:13] Zaid: ok\n[13/11/2026, 16:54] Dad: new one ${c.NEW}\n[13/11/2026, 16:55] Zaid: thanks`,
    want: "NEW",
  },
  { name: "two codes on one line, glued", text: (c) => `${c.NEW}${c.OLD}`, want: "NEW" },
  { name: "two codes made at the same time: the last one", text: (c) => `${c.NEW}\n${c.TWIN}`, want: "TWIN" },
  { name: "two codes made at the same time, other order", text: (c) => `${c.TWIN}\n${c.NEW}`, want: "NEW" },
  { name: "a deck code and a save code", text: (c) => `deck K7Q2-M9XA-3FB1 and save ${c.NEW}`, want: "NEW" },
];

const REFUSES: Case[] = [
  { name: "a deck code alone", text: () => "K7Q2-M9XA-3FB1", want: "deck-code" },
  { name: "a deck code with direction marks", text: () => "\u200fK7Q2\u2011M9XA\u20113FB1\u200f", want: "deck-code" },
  { name: "a deck code in quotes", text: () => "“K7Q2 M9XA 3FB1”", want: "deck-code" },
  { name: "a deck code in a WhatsApp line", text: () => "[13/11/2026, 16:54] Dad: my deck K7Q2-M9XA-3FB1", want: "deck-code" },
  { name: "one changed character", text: (c) => typo(c.NEW), want: "typo" },
  { name: "one changed character, with words around", text: (c) => `Here's my save code: ${typo(c.NEW)} thanks so much for this`, want: "typo" },
  { name: "one changed character, wrapped", text: (c) => wrap(typo(c.NEW, 100), 76, "\r\n"), want: "typo" },
  { name: "a cut-off code", text: (c) => c.NEW.slice(0, Math.floor(c.NEW.length * 0.7)), want: "typo" },
  { name: "a cut-off code in a chat line", text: (c) => `[13/11/2026, 16:54] Dad: ${c.NEW.slice(0, -20)}`, want: "typo" },
  { name: "the last few characters missing", text: (c) => c.NEW.slice(0, -5), want: "typo" },
  { name: "a random sentence", text: () => "hello there, how are you? see you at 5", want: "not-a-code" },
  { name: "a footballer", text: () => "CR7 is the best player ever", want: "not-a-code" },
  { name: "an Arabic sentence", text: () => "\u200fمرحبا، كيف حالك؟ \u2068١٢٣\u2069", want: "not-a-code" },
  { name: "a code from a newer game", text: (c) => newerCode(c.NEW), want: "newer" },
  { name: "a code from a newer game, in a chat line", text: (c) => `[13/11/2026, 16:54] Dad: ${newerCode(c.NEW)}`, want: "newer" },
  { name: "nothing but invisible marks", text: () => "\u200f\u200e\u2068\u2069\n ", want: "empty" },
];

const CORPUS = [...LOADS, ...REFUSES];

function outcome(r: DecodeResult): "NEW" | "OLD" | "TWIN" | "other-save" | SaveError {
  if (!r.ok) return r.reason;
  for (const [name, data] of [["NEW", NEW], ["OLD", OLD], ["TWIN", TWIN]] as const) {
    if (JSON.stringify(r.data) === JSON.stringify(data)) return name;
  }
  return "other-save";
}

describe("save codes as people paste them", () => {
  it("the test codes have the characters the cases bend", () => {
    for (const p of ["Z", "P"] as const) {
      for (const c of [codes[p].NEW]) {
        expect(c.startsWith(`CR1${p}`)).toBe(true);
        if (p === "Z") expect(c).toMatch(/-/); // (plain JSON in base64 rarely makes a "-")
        expect(c).toMatch(/[0-9].*[0-9]/);
        expect(c.length).toBeGreaterThan(400);
      }
    }
  });

  for (const p of ["Z", "P"] as const) {
    describe(`packing ${p}`, () => {
      for (const c of CORPUS) {
        it(c.name, async () => {
          const text = c.text(codes[p]);
          expect(outcome(await decodeSave(text)), JSON.stringify(text.slice(0, 80))).toBe(c.want);
        });
      }
    });
  }
});

describe("never loads anything but the save that was sent", () => {
  it("a typo stays a typo, whatever is around it", async () => {
    // About 1 in 8 one-character typos still unpacks into a readable save
    // with different numbers; the check character is what catches it, so no
    // longer or shorter cut of the text may slip past it.
    for (const p of ["Z", "P"] as const) {
      const code = codes[p].NEW;
      for (let at = 4; at < code.length; at += 7) {
        for (const around of [(x: string) => x, (x: string) => `${x} thanks so much for the code dad`, (x: string) => `${x}thanks`]) {
          const r = await decodeSave(around(typo(code, at)));
          expect(r.ok, `${p} typo at ${at}`).toBe(false);
        }
      }
    }
  });

  it("text pasted next to the code never changes what loads", async () => {
    let seed = 11;
    const rnd = (n: number): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) % n;
    const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (const p of ["Z", "P"] as const) {
      for (let i = 0; i < 150; i++) {
        const glued = Array.from({ length: 1 + rnd(FIND_LIMITS.trim) }, () => ALPHA[rnd(64)]).join("");
        const words = Array.from({ length: rnd(6) }, () => Array.from({ length: 1 + rnd(9) }, () => ALPHA[rnd(64)]).join(""));
        const text = [codes[p].NEW + glued, ...words].join(rnd(2) ? " " : "\n");
        expect(outcome(await decodeSave(text)), text.slice(-60)).toBe("NEW");
      }
    }
  });
});

describe("cleaning", () => {
  it("reads look-alikes as the plain characters and drops invisible marks", () => {
    expect(cleanPasted("ＣＲ１Ｚ\uff0d＿")).toBe("CR1Z-_");
    expect(cleanPasted("a\u2010b\u2011c\u2012d\u2013e\u2212f\ufe63g\uff0dh")).toBe("a-b-c-d-e-f-g-h");
    expect(cleanPasted("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789 0123456789");
    expect(cleanPasted("a\u200eb\u200fc؜d\u202ae\u202ef\u2066g\u2069h\u00adi\u2061j\u180ek\ufe0fl\u200bm\ufeffn")).toBe("abcdefghijklmn");
    expect(cleanPasted("a\u00a0b\u2009c\u3000d")).toBe("a b c d");
  });
});

describe("work bounds: 400,000 characters of junk stay quick", () => {
  const SIZE = CODE_MAX_CHARS * 2;
  const fill = (unit: string): string => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);
  let seed = 3;
  const randomRun = (n: number): string => {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let s = "";
    for (let i = 0; i < n; i++) s += A[((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 9) & 63];
    return s;
  };
  const junk: [string, () => string][] = [
    ["one run of code heads", () => fill("CR1Z")],
    ["thousands of short lines, each a code head", () => fill("CR1Zab\n")],
    ["many short words, each a code head", () => fill("CR1Za ")],
    ["quoted lines", () => fill("> CR1Zabcdef\r\n")],
    ["wrapped lines of random code characters", () => fill("CR1Z" + randomRun(72) + "\r\n")],
    ["one enormous random run with heads in it", () => fill(randomRun(993) + "CR1Z" + randomRun(3))],
    ["invisible marks between letters", () => fill("a\u200f")],
    ["Arabic text with marks", () => fill("مرحبا\u200f بك ")],
    ["deck-code shapes", () => fill("K7Q2-M9XA-3FB1 ")],
  ];
  for (const [name, make] of junk) {
    it(name, async () => {
      const text = make();
      expect(text.length).toBe(SIZE);
      const t0 = performance.now();
      const r = await decodeSave(text);
      const ms = performance.now() - t0;
      expect(r.ok).toBe(false);
      expect(ms).toBeLessThan(1500); // about 10-40 ms here; generous for a busy machine
    });
  }

  it("still finds a real code after a lot of junk", async () => {
    const code = codes.Z.NEW;
    const text = fill("CR1Zab\n").slice(0, SIZE - code.length - 1) + "\n" + code;
    const t0 = performance.now();
    expect(outcome(await decodeSave(text))).toBe("NEW");
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it("never throws on odd text", async () => {
    for (const text of ["\ud800CR1Z\udc00", "\u0000".repeat(1000), "CR1Z" + "\u0000", ">".repeat(5000), "CR1" + "Z".repeat(CODE_MAX_CHARS + 50)]) {
      const r = await decodeSave(text);
      expect(r.ok).toBe(false);
    }
  });
});
