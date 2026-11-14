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
  NFKC_PIECE,
  checkChar,
  checkOk,
  cleanPasted,
  decodeSave,
  encodeSave,
  lastFindWork,
  saveJson,
  toBase64Url,
  type DecodeResult,
  type FindWork,
  type SaveData,
  type SaveError,
} from "./saveCode";

const DECK = ["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"];

/** A profile shaped like a real one (the keys a browser save holds after a few battles). */
function profile(at: number, trophies: number, gold: number, owned: string[]): SaveData {
  const slot = { name: "", cards: DECK };
  // A named deck: "~" in the JSON makes a "-" in the plain packing too (plain JSON in base64 rarely has one).
  const named = { name: "Rush ~~~", cards: DECK };
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
      "cr-clone-deck-slots": JSON.stringify({ v: 1, active: 0, slots: [named, slot, slot] }),
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

/** The code with a space every `n` characters. */
const spaced = (code: string, n: number): string => code.match(new RegExp(`.{1,${n}}`, "g"))!.join(" ");

/** A save file kept as UTF-16 (old Notepad's "Unicode"), with its byte order mark, read the way the file picker reads it (UTF-8). */
function utf16File(text: string, littleEndian: boolean): string {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[littleEndian ? 0 : 1] = 0xff;
  bytes[littleEndian ? 1 : 0] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    bytes[2 + 2 * i + (littleEndian ? 0 : 1)] = c & 255;
    bytes[2 + 2 * i + (littleEndian ? 1 : 0)] = c >> 8;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * "CR2Zab" with its check character and three more letters glued on: the
 * word's own check does not fit, but cut back by three it does. A word that
 * short is not a code from a newer game.
 */
function newerWord(): string {
  const body = "CR2Zab";
  for (const tail of ["xyz", "xyw", "qrs", "klm"]) {
    const word = body + checkChar(body) + tail;
    if (!checkOk(word)) return word;
  }
  throw new Error("no tail");
}

/** "CR1v1 me tomorrow?": the last letter makes the check of the whole sentence (spaces out) fit. */
function fittingSentence(): string {
  const words = "CR1v1 me tomorrow";
  return words + checkChar(words.replace(/ /g, ""));
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
  { name: "Arabic words with harakat around it", text: (c) => `قَالَ أَبِي: \u2068${c.NEW}\u2069 شُكْرًا لَكَ`, want: "NEW" },
  { name: "an accent that joined the code's last letter", text: (c) => `${c.NEW}\u0301 ok`, want: "NEW" },
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
  { name: "a line break right after CR", text: (c) => `Here is my save code for you, have fun: CR\n${wrap(c.NEW.slice(2), 76, "\n")}`, want: "NEW" },
  { name: "a line break inside its start", text: (c) => `${c.NEW.slice(0, 3)}\r\n${c.NEW.slice(3)}`, want: "NEW" },
  { name: "typed in groups of 3", text: (c) => spaced(c.NEW, 3), want: "NEW" },
  { name: "typed in groups of 4", text: (c) => spaced(c.NEW, 4), want: "NEW" },
  { name: "a space between every character", text: (c) => spaced(c.NEW, 1), want: "NEW" },
  // A long plain code (an old tablet's) in groups is hundreds of groups.
  { name: "typed in groups of 3, among other words", text: (c) => `Here's the code: ${spaced(c.NEW, 3)} thanks`, want: "NEW" },
  { name: "typed in groups of 4, among other words", text: (c) => `Here's the code: ${spaced(c.NEW, 4)} thanks`, want: "NEW" },
  { name: "a space between every character, among other words", text: (c) => `code ${spaced(c.NEW, 1)} ok`, want: "NEW" },
  { name: "76-character lines with NEL line breaks", text: (c) => wrap(c.NEW, 76, "\u0085"), want: "NEW" },
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
  { name: "save file kept as UTF-16, little-endian", text: (c) => utf16File(`${c.NEW}\r\n`, true), want: "NEW" },
  { name: "save file kept as UTF-16, big-endian", text: (c) => utf16File(`Crown Rush save\r\n${c.NEW}\r\n`, false), want: "NEW" },
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
  { name: "a phone number and a save code", text: (c) => `call me on 0501-2345-6789, the code is ${c.NEW}`, want: "NEW" },
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
  { name: "a deck code and a cut-off save code", text: (c) => `deck K7Q2-M9XA-3FB1 and save ${c.NEW.slice(0, -40)}`, want: "typo" },
  { name: "a deck code and a save code with one changed character", text: (c) => `deck K7Q2-M9XA-3FB1 and save ${typo(c.NEW)}`, want: "typo" },
  { name: "a random sentence", text: () => "hello there, how are you? see you at 5", want: "not-a-code" },
  { name: "a phone number", text: () => "call me on 0501-2345-6789 tonight", want: "not-a-code" },
  { name: "a footballer", text: () => "CR7 is the best player ever", want: "not-a-code" },
  { name: "a fan", text: () => "I'm a CR7fan and so is my dad", want: "not-a-code" },
  { name: "a fan, at length", text: () => "I'm a CR7fan and so is my dad and my uncle and my whole family too", want: "not-a-code" },
  { name: "a footballer, at length", text: () => "Look at CR7Ronaldo playing football in the park with all his friends today", want: "not-a-code" },
  { name: "a sentence that starts like a code", text: () => "CR1Zebra is what the code started with but then I lost the rest of it sorry", want: "not-a-code" },
  { name: "a footballer, words only", text: () => "CR7 is the best player ever and he plays for my favourite team in the world", want: "not-a-code" },
  { name: "a short word from a newer game whose cut fits its check", text: () => `my score was ${newerWord()} today`, want: "not-a-code" },
  { name: "a short sentence whose check happens to fit", text: () => fittingSentence(), want: "not-a-code" },
  { name: "one changed character, in groups among other words", text: (c) => `Here's the code: ${spaced(typo(c.NEW), 3)} thanks`, want: "typo" },
  { name: "a cut-off code, in groups among other words", text: (c) => `Here's the code: ${spaced(c.NEW.slice(0, -30), 4)} thanks`, want: "typo" },
  { name: "an Arabic sentence", text: () => "\u200fمرحبا، كيف حالك؟ \u2068١٢٣\u2069", want: "not-a-code" },
  { name: "a code from a newer game", text: (c) => newerCode(c.NEW), want: "newer" },
  { name: "a code from a newer game, in a chat line", text: (c) => `[13/11/2026, 16:54] Dad: ${newerCode(c.NEW)}`, want: "newer" },
  { name: "a code from a newer game, with a word glued on", text: (c) => `${newerCode(c.NEW)}thanks`, want: "newer" },
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
        expect(c).toMatch(/-/);
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

describe("a code loads only as itself", () => {
  it("a plain code's JSON ends the code: nothing may come after its closing brace", async () => {
    // JSON.parse would let a space or line break through; with a word glued
    // on, a longer cut of a typo'd plain code could end in one.
    const make = (json: string): string => {
      const body = "CR1P" + toBase64Url(new TextEncoder().encode(json));
      return body + checkChar(body);
    };
    expect(outcome(await decodeSave(make(saveJson(NEW))))).toBe("NEW");
    for (const json of [saveJson(NEW) + " ", saveJson(NEW) + "\n", saveJson(NEW) + "\t", saveJson(NEW) + "\r\n", " " + saveJson(NEW)]) {
      expect(await decodeSave(make(json)), JSON.stringify(json.slice(-3))).toEqual({ ok: false, reason: "damaged" });
    }
  });

  it("a cut-off code whose check happens to fit is still told to be copied again", async () => {
    for (const p of ["Z", "P"] as const) {
      const code = codes[p].NEW;
      let k = code.length - 2;
      while (!checkOk(code.slice(0, k))) k--; // about 1 in 64 cuts
      expect(k).toBeGreaterThan(100);
      expect(await decodeSave(code.slice(0, k)), `${p} cut at ${k}`).toEqual({ ok: false, reason: "typo" });
      expect(await decodeSave(`[13/11/2026, 16:54] Dad: ${code.slice(0, k)}`)).toEqual({ ok: false, reason: "typo" });
    }
  });

  it("a long code is read a piece at a time and loads with words around it", async () => {
    let seed = 5;
    const digits = Array.from({ length: 80_000 }, () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) % 10).join("");
    const big: SaveData = { ...NEW, keys: { ...NEW.keys, "cr-clone-quests": JSON.stringify({ pad: digits }) } };
    for (const compress of [true, false]) {
      const code = await encodeSave(big, { compress });
      expect(code.length).toBeGreaterThan(30_000); // many times the first piece read (2,048)
      const r = await decodeSave(`[13/11/2026, 16:54] Dad: here you go\u200f ${code}thanks!`);
      expect(r.ok && JSON.stringify(r.data) === JSON.stringify(big), `compress ${compress}`).toBe(true);
    }
  });
});

describe("a save whose deck names hold quotes, backslashes and brackets", () => {
  // A deck name is JSON inside the save's JSON, so its quote or backslash is
  // escaped twice in a plain code: where the code's JSON ends must be found
  // with escapes in mind, or the code reads as cut off or damaged.
  const names = ['Za"id\'s {best} [deck]', "a\\", '"', "\\\\\"}", "}]"];
  const ODD: SaveData = {
    ...NEW,
    keys: { ...NEW.keys, "cr-clone-deck-slots": JSON.stringify({ v: 1, active: 0, slots: names.map((name) => ({ name, cards: DECK })) }) },
  };
  for (const compress of [true, false]) {
    it(compress ? "packing Z" : "packing P", async () => {
      const code = await encodeSave(ODD, { compress });
      if (!compress) expect(saveJson(ODD)).toContain('\\\\\\"'); // an escaped backslash next to an escaped quote
      for (const text of [code, `Here's my save code: ${code} thanks!`, `${code}thanks`, `> ${wrap(code, 70, "\n> ")}\n> bye`, `[13/11/2026, 16:54] Dad: ${code}`]) {
        const r = await decodeSave(text);
        expect(r.ok && JSON.stringify(r.data) === JSON.stringify(ODD), text.slice(0, 40)).toBe(true);
      }
    });
  }
});

describe("cleaning", () => {
  it("drops NUL (a UTF-16 save file read as UTF-8)", () => {
    expect(cleanPasted("C\u0000R\u00001\u0000Z\u0000")).toBe("CR1Z");
  });

  /** The same cleaning done on the whole text at once (no pieces). */
  const cleanWhole = (text: string): string =>
    text
      .replace(/[\0\p{Cf}\p{Default_Ignorable_Code_Point}\p{M}]+/gu, "")
      .normalize("NFKC")
      .replace(/[\0\p{Cf}\p{Default_Ignorable_Code_Point}]+/gu, "");

  it("normalises long text a piece at a time with the same result as all at once", () => {
    const bits = ["ｃ", "e\u0301", "\u1100\u1161\u11a8", "\u{1F600}", "\ufdfa", "Ａ\u0308", "\u0915\u093c", "ﾊﾟ", "ㄱㅏ", "\uffa1\uffc2", "\u00e9", " "];
    const text = Array.from({ length: 30_000 }, (_, i) => bits[(i * 7) % bits.length]).join("");
    expect(text.length).toBeGreaterThan(40_000);
    expect(cleanPasted(text)).toBe(cleanWhole(text));
  });

  it("never cuts a piece before a character that joins the one before it", () => {
    // Each pair sits right where the first piece would end.
    const pairs: [string, string, string][] = [
      ["ｶ", "ﾞ", "ガ"], // halfwidth kana and its voiced mark
      ["ﾊ", "ﾟ", "パ"],
      ["ㄱ", "ㅏ", "가"], // Hangul compatibility jamo
      ["\uffa1", "\uffc2", "가"], // halfwidth Hangul
      ["\u1100", "\u1161", "가"], // Hangul jamo
      ["가", "\u11a8", "각"],
      ["\ud83d", "\ude00", "\u{1F600}"], // the two halves of a pair
    ];
    for (const [a, b, joined] of pairs) {
      const text = "x".repeat(NFKC_PIECE - a.length) + a + b + "y".repeat(100);
      expect(text.indexOf(b, NFKC_PIECE - 1)).toBe(NFKC_PIECE);
      const out = cleanPasted(text);
      expect(out, a + b).toBe(cleanWhole(text));
      expect(out).toContain(joined);
    }
  });

  it("drops combining marks: an accent or harakat is never part of a code", () => {
    expect(cleanPasted("e\u0301 \u00e9 \u0628\u064e\u0651 a\u0301\u0316\u0334\u0345")).toBe("e \u00e9 \u0628 a");
    expect(cleanPasted("Z\u0301")).toBe("Z"); // NFKC would have made it one letter, "Ź"
  });

  it("reads NEL as a line break", async () => {
    const code = await encodeSave(NEW);
    expect(outcome(await decodeSave(`Code:\u0085${wrap(code, 60, "\u0085")}\u0085thanks`))).toBe("NEW");
  });

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
  const words = (n: number): string => Array.from({ length: n }, () => randomRun(2)).join(" ");
  const twice = (block: () => string): string => (block() + "\n" + block()).slice(0, SIZE);
  /** `runs` runs of "CR1Z" + the stream (cut to fit), each followed by `perRun` short words whose last letter makes the check fit. */
  function crafted(stream: Uint8Array, runs: number, perRun: number, head = "CR1Z"): string {
    const per = Math.floor(SIZE / runs) - perRun * 6 - 4;
    let out = "";
    for (let r = 0; r < runs; r++) {
      let body = (head + toBase64Url(stream)).slice(0, per);
      let text = body;
      for (let j = 0; j < perRun; j++) {
        const mid = randomRun(3);
        body += mid;
        const c = checkChar(body);
        text += " " + mid + c;
        body += c;
      }
      out += text + " .\n";
    }
    return out.slice(0, SIZE);
  }
  /** Raw DEFLATE written bit by bit. */
  function bitWriter(): { put: (v: number, n: number) => void; code: (c: number, len: number) => void; bytes: number[] } {
    const bytes: number[] = [];
    let acc = 0;
    let nb = 0;
    const put = (v: number, n: number): void => {
      for (let i = 0; i < n; i++) {
        acc |= ((v >> i) & 1) << nb;
        if (++nb === 8) {
          bytes.push(acc);
          acc = 0;
          nb = 0;
        }
      }
    };
    const code = (c: number, len: number): void => {
      for (let i = len - 1; i >= 0; i--) put((c >> i) & 1, 1);
    };
    return { put, code, bytes };
  }
  const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  /** Dynamic blocks that hold nothing: a header to read each time, and no output. */
  function emptyBlocks(size: number): Uint8Array {
    const w = bitWriter();
    const cl: Record<number, number> = { 18: 1, 0: 2, 1: 2 }; // canonical: 18 "0", 0 "10", 1 "11"
    while (w.bytes.length < size) {
      w.put(0, 1);
      w.put(2, 2);
      w.put(0, 5);
      w.put(0, 5);
      w.put(14, 4);
      for (const o of CLEN_ORDER.slice(0, 18)) w.put(cl[o] ?? 0, 3);
      w.code(0, 1);
      w.put(138 - 11, 7);
      w.code(0, 1);
      w.put(118 - 11, 7); // 256 zero lengths
      w.code(3, 2); // end of block: length 1
      w.code(2, 2); // the one distance code: unused
      w.code(0, 1); // end of block
    }
    return Uint8Array.from(w.bytes);
  }
  /** One dynamic block where "a" has a 15-bit code (fifteen 0 bits), then "a" for ever: the slowest letters to unpack. */
  function longCodes(size: number): Uint8Array {
    const w = bitWriter();
    w.put(1, 1);
    w.put(2, 2);
    w.put(0, 5);
    w.put(0, 5);
    w.put(15, 4);
    const cl: Record<number, number> = { 0: 2, 15: 2, 18: 2 }; // canonical: 0 "00", 15 "01", 18 "10"
    for (const o of CLEN_ORDER) w.put(cl[o] ?? 0, 3);
    w.code(2, 2);
    w.put(97 - 11, 7); // 97 zeros
    w.code(1, 2); // "a": 15
    w.code(2, 2);
    w.put(138 - 11, 7);
    w.code(2, 2);
    w.put(20 - 11, 7); // 158 zeros
    w.code(1, 2); // end of block: 15
    w.code(0, 2); // distance: 0
    w.put(0, 8);
    const out = new Uint8Array(size);
    out.set(w.bytes);
    return out;
  }
  /** 64 code starts, then four-letter words: each start may continue into 4,096 of them, trimmed 3 ways each. */
  const sea = (): string => ("CR1Zabcd ".repeat(64) + Array.from({ length: SIZE / 5 }, () => randomRun(4)).join(" ")).slice(0, SIZE);
  /**
   * Plain-packing starts, each a JSON string that never closes, joined by
   * spaces one after another, each with a word after it that makes its
   * check fit: every start is read to the end of the text.
   */
  function neverCloses(): string {
    const run = "CR1P" + toBase64Url(new TextEncoder().encode('{"g":"' + "a".repeat(36_000)));
    let text = "";
    for (let r = 0; r < 8; r++) {
      const mid = randomRun(3);
      text += run + " " + mid + checkChar(run + mid) + " ";
    }
    expect(text.length).toBeLessThanOrEqual(SIZE);
    return text;
  }
  const streams: { long: Uint8Array; bomb: Uint8Array } = { long: new Uint8Array(0), bomb: new Uint8Array(0) };
  beforeAll(async () => {
    const pack = async (bytes: Uint8Array): Promise<Uint8Array> => {
      const s = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw" as CompressionFormat));
      return new Uint8Array(await new Response(s).arrayBuffer());
    };
    let r = 9;
    const letters = Uint8Array.from({ length: 1_200_000 }, () => 97 + (((r = (Math.imul(r, 1103515245) + 12345) >>> 0) >>> 16) % 3));
    streams.long = await pack(letters);
    streams.bomb = await pack(new Uint8Array(5_000_000).fill(97));
    expect(streams.long.length).toBeGreaterThan(200_000);
    expect(streams.bomb.length).toBeLessThan(10_000);
  });
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
    ["a space between every character", () => fill("C R 1 Z a b ")],
    ["NUL between letters", () => fill("CR1Z\u0000")],
    ["characters that spread out when cleaned (U+FDFA is 18)", () => fill("\ufdfa")],
    ["fullwidth code heads", () => fill("ＣＲ１Ｚａｂ ")],
    // One enormous run, then many short words joined to it by spaces: about
    // 100 cuts of each start have a fitting check.
    ["two enormous runs, each followed by 400 short words", () => twice(() => "CR1ZCR1ZCR1Z" + randomRun(199_000) + " " + words(400))],
    ["the same with plain-packing starts", () => twice(() => "CR1PCR1PCR1P" + randomRun(199_000) + " " + words(400))],
    // Real packed data that goes on and on, with short words after it whose
    // last letter makes the check fit: every start is worth reading.
    ["long packed streams with check-fitting words after", () => crafted(streams.long, 3, 16)],
    ["one long packed stream, split in two", () => crafted(streams.long, 2, 16)],
    ["packed streams that unpack past the cap", () => crafted(streams.bomb, 64, 1)],
    ["the same, with 16 fitting words each", () => crafted(streams.bomb, 3, 16)],
    ["empty packed blocks, one after another", () => crafted(emptyBlocks(160_000), 2, 16)],
    ["packed letters with 15-bit codes", () => crafted(longCodes(200_000), 2, 16)],
    ["a plain JSON string that never closes", () => crafted(new TextEncoder().encode('{"g":"' + "a".repeat(160_000)), 2, 16, "CR1P")],
    // Many starts, each followed by thousands of short words it may continue into.
    ["starts followed by 4,096 two-letter words each", () => fill("CR1Z" + randomRun(20) + " " + words(4096) + "\n")],
    ["64 starts, then a sea of four-letter words", sea],
    ["plain-packing starts whose JSON never closes, one after another", neverCloses],
    ["empty packed blocks in 16 runs", () => crafted(emptyBlocks(20_000), 16, 16)],
    ["plain-packing starts followed by 2,000 one-letter words each", () => fill("CR1P" + randomRun(20) + " " + Array.from({ length: 2000 }, () => randomRun(1)).join(" ") + "\n")],
    // Combining marks: NFKC sorts a run of mixed marks one by one (2-3 s here before they were dropped first).
    ["a letter and 400,000 alternating marks", () => ("a" + "\u0301\u0316".repeat(SIZE)).slice(0, SIZE)],
    ["blocks of 8,200 marks of one kind, then of another", () => ("a" + ("\u0301".repeat(8200) + "\u0316".repeat(8200)).repeat(25)).slice(0, SIZE)],
    ["Zalgo text, 100 marks a letter", () => fill("a" + Array.from({ length: 100 }, (_, i) => String.fromCharCode(0x300 + ((i * 7) % 0x70))).join(""))],
    ["an Arabic letter and 400,000 alternating harakat", () => ("\u0628" + "\u064e\u0651".repeat(SIZE)).slice(0, SIZE)],
    ["four kinds of mark in turn", () => ("a" + "\u0301\u0316\u0334\u0345".repeat(SIZE)).slice(0, SIZE)],
    ["single marks between halfwidth voiced marks (NFKC makes those marks too)", () => ("a" + "\uff9e\u0301".repeat(SIZE)).slice(0, SIZE)],
    ["Arabic text with harakat", () => fill("\u0645\u064e\u0631\u0652\u062d\u064e\u0628\u064b\u0627 ")],
  ];
  /**
   * The most work 400,000 characters may cost: FIND_LIMITS as measured
   * (under about 50 ms of main-thread JS on the build machine for the worst
   * of these). Raise a limit only after measuring again.
   */
  const CEILING: FindWork = { heads: 64, checks: 300_000, readChars: 1_000_000, readBytes: 1_100_000, readBlocks: 2048 };
  for (const [name, make] of junk) {
    it(name, async () => {
      const text = make();
      expect(text.length).toBeLessThanOrEqual(SIZE);
      const t0 = performance.now();
      const r = await decodeSave(text);
      const ms = performance.now() - t0;
      expect(r.ok).toBe(false);
      const w = lastFindWork();
      for (const key of Object.keys(CEILING) as (keyof FindWork)[]) {
        expect(w[key], key).toBeLessThanOrEqual(Math.min(CEILING[key], FIND_LIMITS[key]));
      }
      expect(ms).toBeLessThan(1000); // under about 50 ms here; generous for a busy machine
    });
  }

  it("the work counted is real work", async () => {
    // The ceilings above mean something only if the counter counts: these
    // inputs reach each limit (the finder stops there).
    const hit = async (text: string, key: keyof FindWork): Promise<void> => {
      await decodeSave(text);
      expect(lastFindWork()[key], key).toBeGreaterThan(CEILING[key] * 0.6);
    };
    await hit(sea(), "checks");
    await hit(crafted(streams.bomb, 64, 1), "readBytes");
    await hit(crafted(emptyBlocks(160_000), 2, 16), "readBlocks");
    await hit(crafted(emptyBlocks(20_000), 16, 16), "readBlocks");
    await hit(crafted(streams.long, 3, 16), "readChars");
    await hit(neverCloses(), "readChars");
    await decodeSave(fill("CR1Zab\n"));
    expect(lastFindWork().heads).toBe(CEILING.heads);
  });

  it("still finds a real code after a lot of junk", async () => {
    const code = codes.Z.NEW;
    const text = fill("CR1Zab\n").slice(0, SIZE - code.length - 1) + "\n" + code;
    const t0 = performance.now();
    expect(outcome(await decodeSave(text))).toBe("NEW");
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("never throws on odd text", async () => {
    for (const text of ["\ud800CR1Z\udc00", "\u0000".repeat(1000), "CR1Z" + "\u0000", ">".repeat(5000), "CR1" + "Z".repeat(CODE_MAX_CHARS + 50)]) {
      const r = await decodeSave(text);
      expect(r.ok).toBe(false);
    }
  });
});
