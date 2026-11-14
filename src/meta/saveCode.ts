/**
 * Save codes: the kid's whole game as one line of text, to keep safe or to
 * move to another tablet (or to the other web address: the Render and
 * GitHub Pages links are different sites with separate storage).
 *
 * What goes in: every registered "progress" key that is present
 * (saveKeys.ts), plus the kid's name and crest ("who"; the defaults when
 * none were set), which live in the per-device settings blob. Nothing
 * about the device goes in.
 *
 * The code: "CR" (the game), a format version digit, a packing letter
 * ("Z" = deflate-raw through CompressionStream, "P" = plain where the
 * browser cannot compress; a "Z" code is unpacked by the small decoder
 * below on every browser, so an old tablet opens one too, and the packed
 * data must end exactly where the code ends), the packed JSON in
 * base64url, and one Luhn
 * mod 64 check character, so a wrong or missing character is caught
 * before anything is read. Inside, the JSON names the game and the format
 * again: {"g":"crown-rush","v":1,"t":<ms>,"k":{key: value},"w":{"n","c"}}.
 *
 * Loading is careful: only registered progress keys are kept, values must
 * be strings of a sane size and the shape their key expects (JSON parses,
 * numbers are numbers); the app's own loaders, sanitisers and migrations
 * then run on the reload that follows. Before anything is replaced, this
 * device's progress is written to 'cr-clone-save-backup', so the last load
 * can be undone; an undo swaps the backup with what is here now, so the
 * undo can be undone too and no progress is ever thrown away by it.
 *
 * Pure apart from the injected store and the platform's compression and
 * text codecs; nothing here ever leaves the device.
 */
import { ARENA_THEME_KEY } from "../render3d/theme";
import { PREFS_KEY, CREST_COUNT, sanitizePlayerName, sanitizePrefs } from "../ui/prefs";
import { arenaIndexAt } from "./arenas";
import { memoryKV } from "./kv";
import { loadProfile } from "./progress";
import { PROGRESS_KEYS, PROGRESS_PREFIXES, isProgressKey, saveKeyDef, valueFits } from "./saveKeys";

/** The pre-load backup ('Undo the last load'); a device key. */
export const SAVE_BACKUP_KEY = "cr-clone-save-backup";

/** The game a save belongs to (inside the JSON; "CR" opens the code). */
export const SAVE_GAME = "crown-rush";
/** The newest save format this build reads and writes. */
export const SAVE_FORMAT = 1;
/** Longest code accepted (after spaces and line breaks are removed). */
export const CODE_MAX_CHARS = 200_000;
/** Longest unpacked save accepted (stops a code that unpacks into something huge). */
export const JSON_MAX_CHARS = 1_000_000;
/** Longest single stored value accepted. */
export const VALUE_MAX_CHARS = 100_000;

const HEAD = "CR";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));
/** Each ASCII character's value in the alphabet, or -1. */
const VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) VALUE[ALPHABET.charCodeAt(i)] = i;

/** The kid's name and crest (from the settings blob, which itself stays on the device). */
export interface SaveWho {
  name: string;
  crest: number;
}

/** One save: when it was made, the progress keys, and who. */
export interface SaveData {
  at: number;
  keys: Record<string, string>;
  who?: SaveWho;
}

/** Why a code did not load. */
export type SaveError =
  | "empty"
  | "too-big"
  | "not-a-code"
  | "deck-code"
  | "typo"
  | "newer"
  | "wrong-game"
  | "damaged"
  | "empty-save";

export type DecodeResult = { ok: true; data: SaveData; dropped: string[] } | { ok: false; reason: SaveError };

/** localStorage, or a stand-in. length/key() let prefix keys be listed. */
export interface SaveStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

// ---- Check character ---------------------------------------------------------------

/** The Luhn mod 64 check character for `s` (every character must be in the base64url alphabet). */
export function checkChar(s: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    let addend = factor * (INDEX.get(s[i]) ?? 0);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 64) + (addend % 64);
    sum += addend;
  }
  return ALPHABET[(64 - (sum % 64)) % 64];
}

/** True when the last character of `code` is the right check for the rest. */
export function checkOk(code: string): boolean {
  return code.length > 1 && checkChar(code.slice(0, -1)) === code[code.length - 1];
}

// ---- base64url -----------------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (left > 1) out += ALPHABET[(n >> 6) & 63];
    if (left > 2) out += ALPHABET[n & 63];
  }
  return out;
}

/** The bytes, or null when the text is not base64url. */
export function fromBase64Url(s: string): Uint8Array | null {
  if (s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? VALUE[c] : -1;
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

// ---- Packing ---------------------------------------------------------------------------

/** deflate-raw where the browser has it, else null (the plain packing is used). */
async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  let cs: CompressionStream;
  try {
    cs = new CompressionStream("deflate-raw" as CompressionFormat);
  } catch {
    return null; // an older browser: gzip/deflate only
  }
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

// ---- A small raw-DEFLATE decoder (RFC 1951), after zlib's "puff" ------------------------

/** A canonical Huffman code: how many codes of each length, and the symbols in code order. */
interface Huffman {
  count: Uint16Array;
  symbol: Uint16Array;
}

/** Length codes 257..285: base length and extra bits. */
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
/** Distance codes 0..29: base distance and extra bits. */
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193,
  12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
/** The order code-length code lengths are sent in (dynamic blocks). */
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Thrown inside the decoder for a stream that is malformed. */
class Bad extends Error {}
/** Thrown inside the decoder when the stream needs more bytes than it was given. */
class Short extends Bad {}
/** Thrown inside the decoder when the output passes the cap. */
class TooBig extends Error {}
/** Thrown inside the decoder when it has read as many blocks as it may. */
class Spent extends Error {}

/** Build a Huffman code from code lengths; null when the lengths ask for more codes than fit. */
function huffman(lengths: ArrayLike<number>, from: number, n: number): Huffman | null {
  const count = new Uint16Array(16);
  for (let s = 0; s < n; s++) count[lengths[from + s]]++;
  let left = 1;
  for (let len = 1; len <= 15; len++) {
    left = left * 2 - count[len];
    if (left < 0) return null; // over-subscribed
  }
  const offs = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  const symbol = new Uint16Array(n);
  for (let s = 0; s < n; s++) if (lengths[from + s] !== 0) symbol[offs[lengths[from + s]]++] = s;
  return { count, symbol };
}

let fixedCodes: { lit: Huffman; dist: Huffman } | null = null;
function fixed(): { lit: Huffman; dist: Huffman } {
  if (!fixedCodes) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144);
    l.fill(9, 144, 256);
    l.fill(7, 256, 280);
    l.fill(8, 280, 288);
    fixedCodes = { lit: huffman(l, 0, 288)!, dist: huffman(new Uint8Array(30).fill(5), 0, 30)! };
  }
  return fixedCodes;
}

/**
 * Unpack raw DEFLATE bytes (no zlib or gzip wrapper), stopping at `cap`
 * bytes of output; tested against the platform's own CompressionStream
 * output. Every "Z" code is read with it, not the browser's
 * DecompressionStream: Chrome's refuses bytes after the end of the packed
 * data but others (and Node's) ignore them, and a code must only load as
 * itself. With a word glued on, a code whose packed data still unpacks
 * after a one-character typo (about 1 in 8 typos does) could otherwise load
 * wrong numbers whenever the longer text's check character happened to fit.
 * So bytes after the end are "damaged" here, on every browser.
 */
export function inflateRawJs(src: Uint8Array, cap: number): Uint8Array | "too-big" | "damaged" {
  const r = inflateCore(src, cap);
  if ("fail" in r) return r.fail === "too-big" ? "too-big" : "damaged";
  return r.end === src.length ? r.out : "damaged"; // bytes after the last block: not one whole stream
}

/**
 * What unpacking gave: the output and the number of bytes the stream took
 * (`end`), or why it stopped and how many bytes it had needed by then
 * (`at`; "short": it needed more than it was given), and the output made
 * (`made`). The decoder only ever reads a byte when it needs it, so for any
 * first `n` bytes of the same stream the answer follows from this one:
 * whole when n === end, "too-big" when n >= at, otherwise malformed or short.
 */
type Inflated =
  | { out: Uint8Array; end: number; blocks: number }
  | { fail: "too-big" | "damaged" | "short" | "spent"; at: number; made: number; blocks: number };

/**
 * Unpack `first`; when the stream needs more bytes, `more` may give a
 * longer copy of the same bytes (null: there are no more), so a long stream
 * is read a piece at a time without starting again. At most `maxBlocks`
 * blocks are read ("spent" after that): each block has a header to read,
 * and a stream of empty ones would be all work and no output.
 */
function inflateCore(first: Uint8Array, cap: number, more?: () => Uint8Array | null, maxBlocks = Infinity): Inflated {
  let src = first;
  const grow = (): boolean => {
    const next = more ? more() : null;
    if (!next || next.length <= src.length) return false;
    src = next;
    return true;
  };
  let pos = 0;
  let blocks = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.max(0, Math.min(cap, Math.max(1024, src.length * 4))));
  let outLen = 0;

  const bits = (need: number): number => {
    while (bitCnt < need) {
      if (pos >= src.length && !grow()) throw new Short();
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << need) - 1);
    bitBuf >>>= need;
    bitCnt -= need;
    return v;
  };
  const room = (n: number): void => {
    if (outLen + n <= out.length) return;
    if (outLen + n > cap) throw new TooBig();
    const next = new Uint8Array(Math.min(cap, Math.max(out.length * 2, outLen + n)));
    next.set(out.subarray(0, outLen));
    out = next;
  };
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    let buf = bitBuf; // the bits are read here one at a time, without a call each
    let left = bitCnt;
    for (let len = 1; len <= 15; len++) {
      if (left === 0) {
        if (pos >= src.length && !grow()) throw new Short();
        buf = src[pos++];
        left = 8;
      }
      code |= buf & 1;
      buf >>>= 1;
      left--;
      const count = h.count[len];
      if (code - count < first) {
        bitBuf = buf;
        bitCnt = left;
        return h.symbol[index + (code - first)];
      }
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Bad(); // not a code in this table
  };
  const stored = (): void => {
    bitBuf = 0; // a stored block starts on a byte boundary
    bitCnt = 0;
    while (pos + 4 > src.length) if (!grow()) throw new Short();
    const len = src[pos] | (src[pos + 1] << 8);
    const nlen = src[pos + 2] | (src[pos + 3] << 8);
    pos += 4;
    if ((len ^ 0xffff) !== nlen) throw new Bad();
    while (pos + len > src.length) if (!grow()) throw new Short();
    const from = pos;
    pos += len; // taken before the cap is checked, so `at` counts the whole block
    room(len);
    out.set(src.subarray(from, pos), outLen);
    outLen += len;
  };
  const codes = (lit: Huffman, dist: Huffman): void => {
    for (;;) {
      let sym = decode(lit);
      if (sym < 256) {
        if (outLen === out.length) room(1);
        out[outLen++] = sym;
      } else if (sym === 256) {
        return;
      } else {
        sym -= 257;
        if (sym >= 29) throw new Bad();
        const len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
        const d = decode(dist);
        if (d >= 30) throw new Bad();
        const back = DIST_BASE[d] + bits(DIST_EXTRA[d]);
        if (back > outLen) throw new Bad();
        room(len);
        for (let i = 0; i < len; i++, outLen++) out[outLen] = out[outLen - back];
      }
    }
  };
  const dynamic = (): void => {
    const nlen = bits(5) + 257;
    const ndist = bits(5) + 1;
    const ncode = bits(4) + 4;
    if (nlen > 286 || ndist > 30) throw new Bad();
    const lengths = new Uint8Array(nlen + ndist);
    const clen = new Uint8Array(19);
    for (let i = 0; i < ncode; i++) clen[CLEN_ORDER[i]] = bits(3);
    const lencode = huffman(clen, 0, 19);
    if (!lencode) throw new Bad();
    let i = 0;
    while (i < nlen + ndist) {
      const sym = decode(lencode);
      if (sym < 16) {
        lengths[i++] = sym;
        continue;
      }
      let rep: number;
      let val = 0;
      if (sym === 16) {
        if (i === 0) throw new Bad();
        val = lengths[i - 1];
        rep = 3 + bits(2);
      } else if (sym === 17) {
        rep = 3 + bits(3);
      } else {
        rep = 11 + bits(7);
      }
      if (i + rep > nlen + ndist) throw new Bad();
      lengths.fill(val, i, i + rep);
      i += rep;
    }
    if (lengths[256] === 0) throw new Bad(); // no end-of-block code
    const lit = huffman(lengths, 0, nlen);
    const dist = huffman(lengths, nlen, ndist);
    if (!lit || !dist) throw new Bad();
    codes(lit, dist);
  };

  try {
    let last = 0;
    do {
      if (blocks >= maxBlocks) throw new Spent();
      blocks++;
      last = bits(1);
      const type = bits(2);
      if (type === 0) stored();
      else if (type === 1) codes(fixed().lit, fixed().dist);
      else if (type === 2) dynamic();
      else throw new Bad();
    } while (!last);
  } catch (e) {
    // never throws
    const fail = e instanceof TooBig ? "too-big" : e instanceof Spent ? "spent" : e instanceof Short ? "short" : "damaged";
    return { fail, at: pos, made: outLen, blocks };
  }
  return { out: out.slice(0, outLen), end: pos, blocks };
}

function saveWire(data: SaveData): Record<string, unknown> {
  const wire: Record<string, unknown> = { g: SAVE_GAME, v: SAVE_FORMAT, t: data.at, k: data.keys };
  if (data.who) wire.w = { n: data.who.name, c: data.who.crest };
  return wire;
}

/** The save as the JSON that goes inside a code. */
export function saveJson(data: SaveData): string {
  return JSON.stringify(saveWire(data));
}

/** Make a save code. `compress: false` forces the plain packing (tests; it is also the fallback). */
export async function encodeSave(data: SaveData, opts: { compress?: boolean } = {}): Promise<string> {
  const raw = new TextEncoder().encode(saveJson(data));
  const packed = opts.compress === false ? null : await deflateRaw(raw);
  const body = HEAD + String(SAVE_FORMAT) + (packed ? "Z" : "P") + toBase64Url(packed ?? raw);
  return body + checkChar(body);
}

/** A deck code (deckCode.ts): 12 characters, often in groups of 4. */
const DECK_CODE = /^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/;
/**
 * A deck code the way the game shows it ("K7Q2-M9XA-3FB1"), anywhere in a
 * paste. It needs a letter, so a phone number ("0501-2345-6789") is not one.
 */
const DECK_CODE_IN_TEXT = /(?:^|[^0-9A-Za-z_-])(?=[0-9-]{0,13}[A-Za-z])[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}(?![0-9A-Za-z_-])/;

// ---- Reading a pasted code ---------------------------------------------------------------
//
// People paste a code with things around it: a chat app's header ("[13/11/2026,
// 16:54] Dad: CR1Z...") and their message, quotes or brackets, a full stop,
// an email's "> " quote marks and hard-wrapped lines, Arabic text with
// invisible direction marks, a fullwidth or Arabic-Indic copy of a digit.
// decodeSave cleans the text, then looks for the code inside it. The guard
// against loading the wrong thing is the same as for a bare code: a
// candidate loads only when its check character is right AND it unpacks and
// reads in full (readSaveJson). A wrong cut fails one or the other.

/**
 * Format characters (direction marks, embeddings, isolates, soft hyphens,
 * zero-width ones), other invisibles (variation selectors, fillers) and
 * NUL (a save file kept as UTF-16, read as UTF-8, has one after every letter).
 */
const INVISIBLE = /[\0\p{Cf}\p{Default_Ignorable_Code_Point}]+/gu;
/** Dash look-alikes that apps and keyboards put in place of "-". */
const DASHES = /[\u2010-\u2013\u2212\ufe63\uff0d]/g;
/** Arabic-Indic and Eastern Arabic-Indic digits. */
const INDIC_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g;
const NON_ASCII = /[^\0-\x7f]/;
const MARK = /^\p{M}/u;
/** Long text is normalised a piece at a time, so a few characters that expand a lot (U+FDFA is 18) cannot make it huge. */
const NFKC_PIECE = 16_384;

/** True when NFKC gives the same text cut at `i` as whole: before ASCII, or a character that never joins the one before it. */
function cutsCleanly(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  if (c < 0x80) return true;
  if ((c >= 0xdc00 && c <= 0xdfff) || (c >= 0x1160 && c <= 0x11ff) || (c >= 0xd7b0 && c <= 0xd7ff)) return false; // the second half of a pair; Hangul vowels and finals
  return !MARK.test(s.slice(i, i + 2));
}

/** NFKC, or null as soon as the result passes `max` characters. */
function nfkcUpTo(s: string, max: number): string | null {
  if (!NON_ASCII.test(s)) return s.length > max ? null : s;
  try {
    if (s.length <= NFKC_PIECE) {
      const t = s.normalize("NFKC");
      return t.length > max ? null : t;
    }
    const parts: string[] = [];
    let total = 0;
    for (let i = 0; i < s.length; ) {
      let j = Math.min(s.length, i + NFKC_PIECE);
      for (let k = 0; k < 64 && j < s.length && !cutsCleanly(s, j); k++) j++;
      if (j < s.length && s.charCodeAt(j) >= 0xdc00 && s.charCodeAt(j) <= 0xdfff) j++; // never between the halves of a pair
      const t = s.slice(i, j).normalize("NFKC");
      total += t.length;
      if (total > max) return null;
      parts.push(t);
      i = j;
    }
    return parts.join("");
  } catch {
    return s.length > max ? null : s; // no normalize(): read the text as it is
  }
}

/** cleanPasted, or null when the cleaned text would pass `max` characters. */
function cleanUpTo(text: string, max: number): string | null {
  const s = nfkcUpTo(text.replace(INVISIBLE, ""), max);
  if (s === null) return null;
  return s
    .replace(INVISIBLE, "")
    .replace(DASHES, "-")
    .replace(INDIC_DIGITS, (d) => String(d.charCodeAt(0) & 15));
}

/**
 * Pasted text, cleaned for reading a code: NFKC (fullwidth letters and
 * digits become plain ones; NBSP, thin and ideographic spaces become plain
 * spaces), invisible marks removed, dash look-alikes read as "-",
 * Arabic-Indic digits read as 0-9. Spaces and line breaks are kept: they
 * are where a code may have been wrapped.
 */
export function cleanPasted(text: string): string {
  return cleanUpTo(text, Infinity) ?? "";
}

/**
 * How hard the finder works, so that 400,000 characters of junk stay quick
 * on an old tablet. A real paste uses a tiny part of each.
 */
export const FIND_LIMITS = {
  /** Places a code could start ("CR", a digit, a letter) that are tried: the last ones in the text (a chat's newest code comes last). */
  heads: 64,
  /** Line breaks or spaces one code may continue across (a 900-character code wrapped at 76 is 12 lines). */
  joins: 400,
  /** Characters of a word glued onto the end that may be cut off. */
  trim: 16,
  /** Check-character tests in all (each is a lookup, see `scanPaste`). */
  checks: 300_000,
  /**
   * Code characters read back into bytes, in all. Each start whose check
   * fits somewhere is read once, as far as its longest cut, a piece at a
   * time (2,048 characters, then 4 times as many while the packed data goes
   * on), so junk costs little and a real code (about 900) one piece.
   */
  readChars: 1_000_000,
  /** Bytes unpacked (or, for a plain code, read as JSON), in all: the biggest save, and some. */
  readBytes: JSON_MAX_CHARS + 100_000,
  /** Packed blocks read, in all (each starts with a header to read; a real code has one or a few). */
  readBlocks: 2048,
};
/** The shortest code: "CR1Z", one body character, the check. */
const MIN_CODE = 6;
/**
 * A real code is at least about 70 characters. When nothing loads, a
 * shorter start is not called a broken code ("I'm a CR7fan" is not a typo),
 * except the whole text or word itself, as before.
 */
const CODE_LIKE = 40;
/** The first piece of a start that is read. */
const FIRST_READ = 2048;

/** A value's Luhn addend when it is doubled. */
const DOUBLED = Uint8Array.from({ length: 64 }, (_, x) => Math.floor((2 * x) / 64) + ((2 * x) % 64));
const V_C = INDEX.get("C")!;
const V_R = INDEX.get("R")!;
const V_P = INDEX.get("P")!;
const V_Z = INDEX.get("Z")!;
const V_0 = INDEX.get("0")!;
const V_1 = INDEX.get("1")!;
const V_9 = INDEX.get("9")!;

function isLineBreak(c: number): boolean {
  return c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
}

function isSpace(c: number): boolean {
  return (
    c === 32 ||
    c === 9 ||
    c === 11 ||
    c === 12 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/**
 * Cleaned text as runs of code characters (base64url). `values` holds every
 * run's characters (as alphabet values) back to back; run k is
 * values[start[k], end[k]). `joins[k]` is 1 when only spaces, line breaks
 * and "> " quote marks at the start of a line stand between run k and run
 * k+1, so a code may continue across them.
 */
interface PasteScan {
  values: Uint8Array;
  /** Code characters in all. */
  count: number;
  start: Int32Array;
  end: Int32Array;
  joins: Uint8Array;
  runs: number;
  /** Characters that are not spaces or line breaks. */
  solid: number;
  /** Luhn sums of every prefix, with the even (q0) or odd (q1) positions doubled. */
  q0: Int32Array;
  q1: Int32Array;
}

function scanPaste(s: string): PasteScan {
  const n = s.length;
  const values = new Uint8Array(n);
  const cap = (n >> 1) + 1;
  const start = new Int32Array(cap);
  const end = new Int32Array(cap);
  const joins = new Uint8Array(cap);
  let m = 0;
  let runs = 0;
  let inRun = false;
  let gapOk = true;
  let gapLine = false;
  let solid = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? VALUE[c] : -1;
    if (v >= 0) {
      if (!inRun) {
        if (runs > 0) joins[runs - 1] = gapOk ? 1 : 0;
        inRun = true;
        start[runs] = m;
      }
      values[m++] = v;
      solid++;
      continue;
    }
    if (inRun) {
      end[runs++] = m;
      inRun = false;
      gapOk = true;
      gapLine = false;
    }
    if (isLineBreak(c)) gapLine = true;
    else if (isSpace(c)) continue;
    else {
      solid++;
      if (c !== 62 || !gapLine) gapOk = false; // ">" only as a quote mark after a line break
    }
  }
  if (inRun) end[runs++] = m;
  const q0 = new Int32Array(m + 1);
  const q1 = new Int32Array(m + 1);
  for (let i = 0; i < m; i++) {
    const x = values[i];
    const d = DOUBLED[x];
    q0[i + 1] = q0[i] + (i & 1 ? x : d);
    q1[i + 1] = q1[i] + (i & 1 ? d : x);
  }
  return { values, count: m, start, end, joins, runs, solid, q0, q1 };
}

/** checkOk of the characters values[a, b) as two lookups. */
function checkAt(p: PasteScan, a: number, b: number): boolean {
  const q = b & 1 ? p.q1 : p.q0; // the positions doubled are those with b's parity
  const sum = q[b - 1] - q[a];
  return p.values[b - 1] === (64 - (sum % 64)) % 64;
}

/** "CR", a digit from 1, a letter, starting at values[h]. */
function headAt(v: Uint8Array, h: number, count: number): boolean {
  return h + 3 < count && v[h] === V_C && v[h + 1] === V_R && v[h + 2] >= V_1 && v[h + 2] <= V_9 && v[h + 3] < 52;
}

/**
 * Where codes could start: "CR", a digit from 1, a letter. Inside one run,
 * or split by spaces or a line break ("CR 1Z", "CR\n1Z": a code typed in
 * groups, or wrapped right after its start) when the letter is a real
 * packing (Z or P) and the runs are joined. The last `limit` of them, last
 * first: in a copied chat the newest code comes last, and junk before it
 * cannot use up the work bounds.
 */
function findHeads(p: PasteScan, limit: number): { at: number; run: number }[] {
  const out: { at: number; run: number }[] = [];
  const v = p.values;
  for (let k = p.runs - 1; k >= 0 && out.length < limit; k--) {
    for (let h = p.end[k] - 1; h >= p.start[k] && out.length < limit; h--) {
      if (!headAt(v, h, p.count)) continue;
      if (h + 3 < p.end[k] || splitHead(p, k, h)) out.push({ at: h, run: k });
    }
  }
  return out;
}

function splitHead(p: PasteScan, k: number, h: number): boolean {
  const packing = p.values[h + 3];
  if (packing !== V_Z && packing !== V_P) return false;
  for (let r = k; h + 3 >= p.end[r]; r++) if (!p.joins[r]) return false;
  return true;
}

/** What reading one cut gives. `unsure`: a wrong cut of a good code fails this way too, so it says little. */
type ReadResult = DecodeResult | { ok: false; reason: SaveError; unsure: true };
const UNSURE: ReadResult = { ok: false, reason: "damaged", unsure: true };
/** The packed data goes on past the end of the text: the code was cut off ("Copy the whole code again"). */
const CUT_OFF: ReadResult = { ok: false, reason: "typo", unsure: true };

/**
 * One start's packed data, read once from its longest cut: where it ends
 * (`bytes`) and the JSON bytes it holds, where it passes the size cap, or
 * that it is damaged. Every shorter cut is answered from this (`cutResult`),
 * because both decoders read the bytes in order and never look past what
 * they need. "spent": the work budget ran out first.
 */
type HeadRead =
  | { kind: "end"; bytes: number; raw: Uint8Array; result?: ReadResult }
  | { kind: "too-big"; bytes: number }
  | { kind: "damaged" }
  | { kind: "cut-off" }
  | { kind: "spent" };

interface Budget {
  chars: number;
  bytes: number;
  blocks: number;
}

/** `n` code characters from values[from] as bytes (the first floor(6n/8), as fromBase64Url gives them). */
function bodyBytes(v: Uint8Array, from: number, n: number): Uint8Array {
  const out = new Uint8Array((n * 3) >> 2);
  let o = 0;
  let i = from;
  const to = from + n;
  for (; i + 4 <= to; i += 4) {
    const x = (v[i] << 18) | (v[i + 1] << 12) | (v[i + 2] << 6) | v[i + 3];
    out[o++] = x >> 16;
    out[o++] = (x >> 8) & 255;
    out[o++] = x & 255;
  }
  const left = to - i;
  if (left >= 2) {
    const x = (v[i] << 18) | (v[i + 1] << 12) | (left > 2 ? v[i + 2] << 6 : 0);
    out[o++] = x >> 16;
    if (left > 2) out[o++] = (x >> 8) & 255;
  }
  return out;
}

/** Where the JSON object that opens `b` ends (one past its closing brace), "short" when it goes on past `b`, or "damaged". */
function jsonEnd(b: Uint8Array): number | "short" | "damaged" {
  if (b.length === 0) return "short";
  if (b[0] !== 0x7b) return "damaged";
  let depth = 0;
  let str = false;
  let esc = false;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (str) {
      if (esc) esc = false;
      else if (c === 0x5c) esc = true;
      else if (c === 0x22) str = false;
    } else if (c === 0x22) str = true;
    else if (c === 0x7b || c === 0x5b) depth++;
    else if ((c === 0x7d || c === 0x5d) && --depth === 0) return i + 1;
  }
  return "short";
}

/** Read the start at values[h] up to its longest cut (ending at `maxB`, the check character included). */
function readHead(p: PasteScan, h: number, maxB: number, budget: Budget): HeadRead {
  const packing = p.values[h + 3];
  if (packing !== V_Z && packing !== V_P) return { kind: "damaged" };
  const from = h + 4;
  const most = maxB - 1 - from; // body characters of the longest cut
  if (most <= 0) return { kind: "damaged" };
  if (budget.bytes <= 0) return { kind: "spent" };
  // The body a piece at a time: FIRST_READ characters, then 4 times as many, up to `most`.
  let n = 0;
  let spentHere = false;
  const next = (): Uint8Array | null => {
    if (n >= most) return null;
    const want = Math.min(most, n === 0 ? FIRST_READ : n * 4);
    if (want > budget.chars) {
      spentHere = true;
      return null;
    }
    budget.chars -= want;
    n = want;
    return bodyBytes(p.values, from, n);
  };
  const cutOff = (): HeadRead => (spentHere ? { kind: "spent" } : { kind: "cut-off" }); // still going at the end of the text
  if (packing === V_P) {
    for (;;) {
      const src = next();
      if (!src) return cutOff();
      const e = jsonEnd(src);
      if (e === "damaged") return { kind: "damaged" };
      if (e === "short") continue;
      if (e > budget.bytes) return { kind: "spent" };
      budget.bytes -= e;
      return { kind: "end", bytes: e, raw: src.subarray(0, e) };
    }
  }
  const src = next();
  if (!src) return cutOff();
  const cap = Math.min(JSON_MAX_CHARS, budget.bytes);
  const r = inflateCore(src, cap, next, budget.blocks);
  budget.blocks -= r.blocks;
  if (!("fail" in r)) {
    budget.bytes -= r.out.length;
    return { kind: "end", bytes: r.end, raw: r.out };
  }
  budget.bytes -= r.made;
  if (r.fail === "spent") return { kind: "spent" };
  if (r.fail === "short") return cutOff();
  if (r.fail === "damaged") return { kind: "damaged" };
  return cap < JSON_MAX_CHARS ? { kind: "spent" } : { kind: "too-big", bytes: r.at };
}

/** The JSON bytes of a whole code: exactly one object (JSON.stringify never adds anything around it), then readSaveJson. */
function readJsonBytes(raw: Uint8Array): ReadResult {
  if (raw[0] !== 0x7b || raw[raw.length - 1] !== 0x7d) return UNSURE;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    return UNSURE;
  }
  return readSaveJson(json);
}

/** What reading the code values[h, b) in full would give, from its start's one read. */
function cutResult(p: PasteScan, read: HeadRead, h: number, b: number): ReadResult {
  const body = b - 1 - (h + 4);
  if (body % 4 === 1) return UNSURE; // not base64url
  const bytes = (body * 3) >> 2;
  if (p.values[h + 3] === V_P && bytes > JSON_MAX_CHARS) return { ok: false, reason: "too-big" };
  if (read.kind === "too-big") return bytes >= read.bytes ? { ok: false, reason: "too-big" } : UNSURE;
  if (read.kind === "cut-off") return CUT_OFF;
  if (read.kind !== "end" || bytes !== read.bytes) return UNSURE;
  read.result ??= readJsonBytes(read.raw);
  return read.result;
}

/** When nothing loads, the most helpful reason wins. */
const REASON_RANK: Record<SaveError, number> = {
  empty: 0,
  "not-a-code": 1,
  "deck-code": 3,
  typo: 4,
  damaged: 5,
  "too-big": 6,
  "empty-save": 7,
  "wrong-game": 8,
  newer: 9,
};

/**
 * Read a save code from whatever was pasted or read from a save file: the
 * code may sit among other words and lines, wrapped across lines, with
 * invisible marks or look-alike characters in it. Loads the newest save
 * when the text holds several codes. Never throws.
 */
export async function decodeSave(text: string): Promise<DecodeResult> {
  if (typeof text !== "string") return { ok: false, reason: "empty" };
  if (text.length > CODE_MAX_CHARS * 2) return { ok: false, reason: "too-big" };
  try {
    const s = cleanUpTo(text, CODE_MAX_CHARS * 2);
    if (s === null) return { ok: false, reason: "too-big" }; // characters that spread into many when cleaned
    return findSave(s);
  } catch {
    return { ok: false, reason: "damaged" };
  }
}

function findSave(s: string): DecodeResult {
  const p = scanPaste(s);
  if (p.solid === 0) return { ok: false, reason: "empty" };
  const L = FIND_LIMITS;
  let reason: SaveError = "not-a-code";
  const note = (r: SaveError): void => {
    if (REASON_RANK[r] > REASON_RANK[reason]) reason = r;
  };
  let checks = L.checks;
  const budget: Budget = { chars: L.readChars, bytes: L.readBytes, blocks: L.readBlocks };
  let spent = false;
  let triedWhole = false;
  let best: { data: SaveData; dropped: string[]; at: number } | null = null;

  const heads = findHeads(p, L.heads);
  for (const { at: h, run: k } of heads) {
    if (p.end[k] - L.trim - h > CODE_MAX_CHARS) {
      note("too-big");
      continue;
    }
    // Where the code could end: the end of this run (`own`) or of a run it
    // continues into (`low`: how far a word glued onto that end may be cut
    // back), or right where another code starts (two codes pasted with
    // nothing between).
    const ends: { b: number; low: number; own: boolean }[] = [{ b: p.end[k], low: h + MIN_CODE, own: true }];
    let whole = false; // the last end takes in the whole wrapped run (only there does a garbled or cut-off code say so)
    for (let r = k; ; r++) {
      if (r + 1 >= p.runs || !p.joins[r]) {
        whole = true;
        break;
      }
      if (ends.length > L.joins || p.end[r + 1] - h > CODE_MAX_CHARS + L.trim) break;
      ends.push({ b: p.end[r + 1], low: Math.max(p.start[r + 1] + 1, h + MIN_CODE), own: false });
    }
    const last = ends[ends.length - 1].b;
    if (h === 0 && whole && last === p.count) triedWhole = true;
    for (const o of heads) if (o.at >= h + MIN_CODE && o.at < last) ends.push({ b: o.at, low: o.at, own: false });
    ends.sort((x, y) => x.b - y.b);
    const newer = p.values[h + 2] - V_0 > SAVE_FORMAT;
    let read: HeadRead | null = null;
    let loaded = false;
    search: for (let t = 0; t <= L.trim; t++) {
      for (let j = 0; j < ends.length; j++) {
        const e = ends[j];
        const b = e.b - t;
        if (b < e.low || b - h > CODE_MAX_CHARS) continue;
        if (checks-- <= 0) break search;
        if (!checkAt(p, h, b)) continue;
        if (newer) {
          // A code from a newer game: the check is all there is to go on, so
          // only its own word, or a cut long enough to be a code.
          if ((t === 0 && e.own) || b - h >= CODE_LIKE) note("newer");
          continue;
        }
        read ??= readHead(p, h, last, budget);
        if (read.kind === "spent") {
          spent = true;
          break search;
        }
        const res = cutResult(p, read, h, b);
        if (res.ok) {
          // Several codes: the newest save; the same time, the last one in the text.
          const at = res.data.at;
          if (!best || at > best.data.at || (at === best.data.at && h > best.at)) best = { data: res.data, dropped: res.dropped, at: h };
          loaded = true;
          break search;
        }
        if (!("unsure" in res)) note(res.reason);
        else if (t === 0 && whole && b === last) note(res.reason); // the whole run: garbled ("damaged") or cut off ("typo")
      }
    }
    if (!loaded && (last - h >= CODE_LIKE || (whole && h === 0 && last === p.count))) note("typo");
    if (spent) break;
  }
  if (best) return { ok: true, data: best.data, dropped: best.dropped };

  // The old rule still holds: when the whole paste, spaces and line breaks
  // taken out, is one code (however it was spaced), it is read as one.
  // ("CR7 is the best player ever" is not called a broken code, though.)
  if (!spent && !triedWhole && p.solid === p.count && p.count <= CODE_MAX_CHARS && headAt(p.values, 0, p.count) && p.count >= MIN_CODE) {
    const n = p.count;
    if (!checkAt(p, 0, n)) {
      if (n >= CODE_LIKE) note("typo");
    } else if (p.values[2] - V_0 > SAVE_FORMAT) {
      if (n >= CODE_LIKE) note("newer");
    } else {
      const read = readHead(p, 0, n, budget);
      if (read.kind !== "spent") {
        const res = cutResult(p, read, 0, n);
        if (res.ok) return { ok: true, data: res.data, dropped: res.dropped };
        note(res.reason);
      }
    }
  }

  if (REASON_RANK[reason] < REASON_RANK["deck-code"]) {
    // A deck code alone (maybe in quotes), or shown the game's way among other words.
    const bare = p.solid <= 40 ? s.replace(/\s+/g, "").replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, "") : "";
    if (DECK_CODE.test(bare) || DECK_CODE_IN_TEXT.test(s)) return { ok: false, reason: "deck-code" };
    if (p.solid > CODE_MAX_CHARS) return { ok: false, reason: "too-big" };
  }
  return { ok: false, reason };
}

/**
 * Check a parsed save (from a code or the backup): the right game, a
 * format this build knows, and only registered progress keys whose values
 * fit. Anything else is dropped and named in `dropped`. A code with no
 * progress in it is refused; a backup may be empty (a tablet that had not
 * played yet), with `allowEmpty`.
 */
export function readSaveJson(json: unknown, opts: { allowEmpty?: boolean } = {}): DecodeResult {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, reason: "damaged" };
  const w = json as Record<string, unknown>;
  if (w.g !== SAVE_GAME) return { ok: false, reason: "wrong-game" };
  if (typeof w.v !== "number" || !Number.isInteger(w.v) || w.v < 1) return { ok: false, reason: "damaged" };
  if (w.v > SAVE_FORMAT) return { ok: false, reason: "newer" };
  const k = w.k;
  if (!k || typeof k !== "object" || Array.isArray(k)) return { ok: false, reason: "damaged" };
  const keys: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(k as Record<string, unknown>)) {
    if (isProgressKey(key) && typeof value === "string" && value.length <= VALUE_MAX_CHARS && valueFits(key, value)) {
      keys[key] = value;
    } else {
      dropped.push(key);
    }
  }
  if (Object.keys(keys).length === 0 && !opts.allowEmpty) return { ok: false, reason: "empty-save" };
  const data: SaveData = { at: typeof w.t === "number" && Number.isFinite(w.t) ? w.t : 0, keys };
  const who = w.w;
  if (who && typeof who === "object") {
    const c = (who as Record<string, unknown>).c;
    data.who = {
      name: sanitizePlayerName((who as Record<string, unknown>).n),
      crest: typeof c === "number" && Number.isInteger(c) && c >= 0 && c < CREST_COUNT ? c : 0,
    };
  }
  return { ok: true, data, dropped };
}

// ---- This device ------------------------------------------------------------------------

/** Every progress key stored here: the listed keys, plus any under a progress prefix. */
export function storedProgressKeys(store: SaveStore): string[] {
  const out = new Set<string>();
  for (const k of PROGRESS_KEYS) {
    try {
      if (store.getItem(k) !== null) out.add(k);
    } catch {
      // unreadable: treat as absent
    }
  }
  if (PROGRESS_PREFIXES.length > 0 && typeof store.length === "number" && store.key) {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && isProgressKey(k)) out.add(k);
    }
  }
  return [...out];
}

/**
 * The kid's name and crest as this device shows them: from the settings
 * blob, or the defaults (no name, the first crest) when no blob is stored
 * or it does not parse, which is what the game shows then. So every save
 * and every backup carries a "who", and an undo or a redo puts the name
 * and crest back too, even on a tablet that never changed a setting.
 * Undefined only when storage cannot be read at all.
 */
export function readWho(store: SaveStore): SaveWho | undefined {
  let raw: string | null = null;
  try {
    raw = store.getItem(PREFS_KEY);
  } catch {
    return undefined;
  }
  let stored: unknown = {};
  try {
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = {};
  }
  const p = sanitizePrefs(stored);
  return { name: p.playerName, crest: p.crest };
}

/** This device's progress, ready to encode. */
export function gatherSave(store: SaveStore, now = Date.now()): SaveData {
  const keys: Record<string, string> = {};
  for (const k of storedProgressKeys(store)) {
    const v = store.getItem(k);
    if (v !== null) keys[k] = v;
  }
  const who = readWho(store);
  return who ? { at: now, keys, who } : { at: now, keys };
}

/** Put the name and crest into the settings blob, leaving every other setting as it is. */
function writeWho(store: SaveStore, who: SaveWho): void {
  let base: unknown = {};
  try {
    const raw = store.getItem(PREFS_KEY);
    if (raw) base = JSON.parse(raw);
  } catch {
    base = {};
  }
  const now = sanitizePrefs(base);
  const name = sanitizePlayerName(who.name);
  if (now.playerName === name && now.crest === who.crest) return; // nothing to change: leave the blob as it is
  store.setItem(PREFS_KEY, JSON.stringify(sanitizePrefs({ ...now, playerName: name, crest: who.crest })));
}

/** Replace this device's progress with `data` (progress keys only). May throw (storage full). */
function writeProgress(store: SaveStore, data: SaveData): void {
  for (const k of storedProgressKeys(store)) {
    if (!(k in data.keys) && !saveKeyDef(k)?.keepIfAbsent) store.removeItem(k);
  }
  for (const [k, v] of Object.entries(data.keys)) store.setItem(k, v);
  if (data.who) writeWho(store, data.who);
}

export type ApplyResult = { ok: true } | { ok: false; reason: "storage" | "no-backup" };

/**
 * When the backup was made: just before a load ("Undo the last load" puts
 * it back), or just before an undo ("Redo the last load" puts that back).
 */
export type BackupKind = "load" | "undo";

/** The one backup slot: the progress this tablet had before the last load or undo. */
export interface SaveBackup {
  data: SaveData;
  kind: BackupKind;
}

function backupJson(data: SaveData, kind: BackupKind): string {
  return JSON.stringify({ ...saveWire(data), b: kind });
}

/**
 * Load a save onto this device: back up this device's progress first,
 * then replace the progress keys (removing ones the save does not have).
 * Device keys are never touched, except the name and crest inside the
 * settings blob. The caller reloads the page afterwards so the app's own
 * loaders and migrations read the new progress.
 */
export function applySave(store: SaveStore, data: SaveData, now = Date.now()): ApplyResult {
  const backup = gatherSave(store, now);
  try {
    store.setItem(SAVE_BACKUP_KEY, backupJson(backup, "load"));
  } catch {
    return { ok: false, reason: "storage" }; // nothing changed yet
  }
  try {
    writeProgress(store, data);
  } catch {
    try {
      writeProgress(store, backup);
    } catch {
      // the backup key still holds it: 'Undo the last load' can try again
    }
    return { ok: false, reason: "storage" };
  }
  return { ok: true };
}

/** The backup slot (what it holds and why it was made), or null when there is none. */
export function readBackupSlot(store: SaveStore): SaveBackup | null {
  let raw: string | null = null;
  try {
    raw = store.getItem(SAVE_BACKUP_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const json: unknown = JSON.parse(raw);
    const r = readSaveJson(json, { allowEmpty: true });
    if (!r.ok) return null;
    return { data: r.data, kind: (json as Record<string, unknown>).b === "undo" ? "undo" : "load" };
  } catch {
    return null;
  }
}

/** The progress kept in the backup slot, or null. */
export function readBackup(store: SaveStore): SaveData | null {
  return readBackupSlot(store)?.data ?? null;
}

/**
 * Put back the progress kept in the backup slot, and keep what is here now
 * in the slot instead, so the undo can itself be undone ("Redo the last
 * load"): nothing earned since the load is ever thrown away by an undo.
 * If storage fills up half way, this tablet and the slot are put back.
 */
export function undoLastLoad(store: SaveStore, now = Date.now()): ApplyResult {
  let raw: string | null = null;
  try {
    raw = store.getItem(SAVE_BACKUP_KEY);
  } catch {
    raw = null;
  }
  const slot = readBackupSlot(store);
  if (!slot || raw === null) return { ok: false, reason: "no-backup" };
  const current = gatherSave(store, now);
  try {
    store.setItem(SAVE_BACKUP_KEY, backupJson(current, slot.kind === "load" ? "undo" : "load"));
  } catch {
    return { ok: false, reason: "storage" }; // nothing changed yet
  }
  try {
    writeProgress(store, slot.data);
  } catch {
    try {
      writeProgress(store, current);
    } catch {
      // the slot holds this tablet's progress from just before: keep it there
      return { ok: false, reason: "storage" };
    }
    try {
      store.setItem(SAVE_BACKUP_KEY, raw); // this tablet is back as it was: so is the slot
    } catch {
      // still full: the slot keeps a copy of this tablet's progress instead
    }
    return { ok: false, reason: "storage" };
  }
  return { ok: true };
}

// ---- What a save holds (the confirm screen) ------------------------------------------------

export interface SaveSummary {
  trophies: number;
  /** Arena index (0 = Training Camp). */
  arena: number;
  /** Cards owned. */
  cards: number;
  gold: number;
  gems: number;
  /** '' when the kid never set one. */
  name: string;
  edition: "normal" | "arabic" | null;
}

/**
 * What the game would show for these keys, read through the game's own
 * profile loader (so a save from before the profile migration reads the
 * way it will after the reload).
 */
export function summarize(data: Pick<SaveData, "keys" | "who">): SaveSummary {
  const p = loadProfile(memoryKV({ ...data.keys }));
  const ed = data.keys[ARENA_THEME_KEY];
  return {
    trophies: p.trophies,
    arena: arenaIndexAt(p.trophies),
    cards: p.owned.length,
    gold: p.gold,
    gems: p.gems,
    name: data.who?.name ?? "",
    edition: ed === "normal" || ed === "arabic" ? ed : null,
  };
}

/** "crown-rush-save-2026-11-13.txt" (local date). */
export function saveFileName(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `crown-rush-save-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.txt`;
}
