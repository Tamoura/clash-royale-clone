/**
 * Save codes: the kid's whole game as one line of text, to keep safe or to
 * move to another tablet (or to the other web address: the Render and
 * GitHub Pages links are different sites with separate storage).
 *
 * What goes in: every registered "progress" key that is present
 * (saveKeys.ts), plus the kid's name and crest ("who"), which live in the
 * per-device settings blob. Nothing about the device goes in.
 *
 * The code: "CR" (the game), a format version digit, a packing letter
 * ("Z" = deflate-raw through CompressionStream, "P" = plain where the
 * browser cannot compress), the packed JSON in base64url, and one Luhn
 * mod 64 check character, so a wrong or missing character is caught
 * before anything is read. Inside, the JSON names the game and the format
 * again: {"g":"crown-rush","v":1,"t":<ms>,"k":{key: value},"w":{"n","c"}}.
 *
 * Loading is careful: only registered progress keys are kept, values must
 * be strings of a sane size and the shape their key expects (JSON parses,
 * numbers are numbers); the app's own loaders, sanitisers and migrations
 * then run on the reload that follows. Before anything is replaced, this
 * device's progress is written to 'cr-clone-save-backup', so the last load
 * can be undone.
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
  | "unsupported"
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
  for (const c of s) {
    const v = INDEX.get(c);
    if (v === undefined) return null;
    acc = (acc << 6) | v;
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

/** Unpack, stopping at `cap` bytes. */
async function inflateRaw(bytes: Uint8Array, cap: number): Promise<Uint8Array | "unsupported" | "too-big" | "damaged"> {
  if (typeof DecompressionStream === "undefined") return "unsupported";
  let ds: DecompressionStream;
  try {
    ds = new DecompressionStream("deflate-raw" as CompressionFormat);
  } catch {
    return "unsupported";
  }
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(ds).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        void reader.cancel().catch(() => undefined);
        return "too-big";
      }
      parts.push(value);
    }
  } catch {
    return "damaged";
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The save as the JSON that goes inside a code (and into the backup). */
export function saveJson(data: SaveData): string {
  const wire: Record<string, unknown> = { g: SAVE_GAME, v: SAVE_FORMAT, t: data.at, k: data.keys };
  if (data.who) wire.w = { n: data.who.name, c: data.who.crest };
  return JSON.stringify(wire);
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

/** Read a save code (spaces and line breaks anywhere are fine). Never throws. */
export async function decodeSave(text: string): Promise<DecodeResult> {
  if (typeof text !== "string") return { ok: false, reason: "empty" };
  if (text.length > CODE_MAX_CHARS * 2) return { ok: false, reason: "too-big" };
  const code = text.replace(/[\s​-‍⁠﻿]+/g, "");
  if (!code) return { ok: false, reason: "empty" };
  if (code.length > CODE_MAX_CHARS) return { ok: false, reason: "too-big" };
  if (DECK_CODE.test(code)) return { ok: false, reason: "deck-code" };
  if (!/^[A-Za-z0-9_-]+$/.test(code) || !code.startsWith(HEAD) || code.length < 6) {
    return { ok: false, reason: "not-a-code" };
  }
  if (!checkOk(code)) return { ok: false, reason: "typo" };
  const version = code[2];
  if (!/[0-9]/.test(version) || Number(version) > SAVE_FORMAT) return { ok: false, reason: "newer" };
  if (Number(version) < 1) return { ok: false, reason: "not-a-code" };
  const packing = code[3];
  const bytes = fromBase64Url(code.slice(4, -1));
  if (!bytes) return { ok: false, reason: "damaged" };
  let raw: Uint8Array;
  if (packing === "P") {
    if (bytes.length > JSON_MAX_CHARS) return { ok: false, reason: "too-big" };
    raw = bytes;
  } else if (packing === "Z") {
    const r = await inflateRaw(bytes, JSON_MAX_CHARS);
    if (typeof r === "string") return { ok: false, reason: r };
    raw = r;
  } else {
    return { ok: false, reason: "damaged" };
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    return { ok: false, reason: "damaged" };
  }
  return readSaveJson(json);
}

/**
 * Check a parsed save (from a code or the backup): the right game, a
 * format this build knows, and only registered progress keys whose values
 * fit. Anything else is dropped and named in `dropped`.
 */
export function readSaveJson(json: unknown): DecodeResult {
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
  if (Object.keys(keys).length === 0) return { ok: false, reason: "empty-save" };
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

/** The kid's name and crest from this device's settings, or undefined when none are stored. */
export function readWho(store: SaveStore): SaveWho | undefined {
  let raw: string | null = null;
  try {
    raw = store.getItem(PREFS_KEY);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  try {
    const p = sanitizePrefs(JSON.parse(raw));
    return { name: p.playerName, crest: p.crest };
  } catch {
    return undefined;
  }
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
 * Load a save onto this device: back up this device's progress first,
 * then replace the progress keys (removing ones the save does not have).
 * Device keys are never touched, except the name and crest inside the
 * settings blob. The caller reloads the page afterwards so the app's own
 * loaders and migrations read the new progress.
 */
export function applySave(store: SaveStore, data: SaveData, now = Date.now()): ApplyResult {
  const backup = gatherSave(store, now);
  try {
    store.setItem(SAVE_BACKUP_KEY, saveJson(backup));
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

/** The progress saved before the last load, or null. */
export function readBackup(store: SaveStore): SaveData | null {
  let raw: string | null = null;
  try {
    raw = store.getItem(SAVE_BACKUP_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const r = readSaveJson(JSON.parse(raw));
    return r.ok ? r.data : null;
  } catch {
    return null;
  }
}

/** Put back the progress from before the last load, then forget the backup. */
export function undoLastLoad(store: SaveStore): ApplyResult {
  const backup = readBackup(store);
  if (!backup) return { ok: false, reason: "no-backup" };
  try {
    writeProgress(store, backup);
  } catch {
    return { ok: false, reason: "storage" };
  }
  try {
    store.removeItem(SAVE_BACKUP_KEY);
  } catch {
    // stays offered; harmless
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
