/**
 * The local problem log: the last few things that went wrong on this
 * device, so a grown-up can copy them into a message (Settings > Help >
 * Problem report). Nothing here ever leaves the device. There is no remote
 * crash reporting and no analytics, on purpose (privacy): the copy button
 * is the only way out, and a grown-up presses it.
 *
 * Each entry keeps the time, the message, the first few stack lines, the
 * build id, the screen and battle phase, the graphics level, the edition,
 * whether an online match was on, and how many times the same message came
 * back. Everything is cleaned and size-capped on the way in and again on
 * the way out of storage, so a broken stored value never breaks boot.
 */
import { ARENA_THEME_KEY } from "../render3d/theme";
import { BUILD_ID } from "./buildInfo";

/** localStorage key (registered with the save package's key list). */
export const PROBLEM_LOG_KEY = "cr-clone-problem-log";
/** Entries kept (newest first). */
export const MAX_PROBLEMS = 20;
/** Longest message kept. */
export const MAX_MESSAGE_CHARS = 240;
/** Stack lines kept per entry. */
export const STACK_LINES = 4;
/** Longest stack line kept. */
export const MAX_STACK_LINE_CHARS = 160;
/** Longest short field (build, screen, quality, edition). */
export const MAX_FIELD_CHARS = 48;
/** The stored JSON never grows past this (oldest entries go first). */
export const MAX_STORED_CHARS = 24_000;
/** Highest repeat count recorded. */
export const MAX_COUNT = 999_999;
/** At most one storage write per this long while errors keep coming. */
export const SAVE_GAP_MS = 1000;

/** Where a problem was caught. */
export type ProblemKind = "frame" | "error" | "promise" | "preview";
const KINDS: readonly ProblemKind[] = ["frame", "error", "promise", "preview"];

/** What the app was doing (main.ts provides it; see setContext). */
export interface ProblemContext {
  /** Screen id, plus the battle phase in a battle ("battle/playing"). */
  screen: string;
  /** Graphics: the pref and the level in force ("auto L2"). */
  quality: string;
  /** "classic", "golden-age" or "unset". */
  edition: string;
  /** An online match was on. */
  online: boolean;
}

export interface Problem extends ProblemContext {
  /** First seen (ms since the epoch). */
  at: number;
  /** Last seen. */
  last: number;
  /** Times seen (identical messages are counted, not repeated). */
  n: number;
  kind: ProblemKind;
  /** "TypeError: x is undefined" (one line, capped). */
  msg: string;
  /** The first few stack lines, with the site's origin taken off. */
  stack: string[];
  build: string;
}

/** The parts of localStorage the log uses. */
export interface ProblemStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

// ---- Cleaning -----------------------------------------------------------------

/** Control and direction-override characters, which could garble a pasted report. */
const UNSAFE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f], // C0 controls, newlines and tabs
  [0x7f, 0x9f], // DEL and C1 controls
  [0x200b, 0x200f], // zero-width characters and direction marks
  [0x2028, 0x202e], // line/paragraph separators and direction overrides
  [0x2066, 0x2069], // direction isolates
  [0xfeff, 0xfeff], // byte-order mark
];
const esc = (n: number): string => `\\u${n.toString(16).padStart(4, "0")}`;
const UNSAFE = new RegExp(`[${UNSAFE_RANGES.map(([a, b]) => `${esc(a)}-${esc(b)}`).join("")}]`, "g");

function asString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === undefined) return "";
  try {
    return String(raw);
  } catch {
    return "";
  }
}

/** One clean line: no control characters, spaces collapsed, at most `max` characters. */
export function cleanText(raw: unknown, max: number): string {
  const flat = asString(raw).replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat;
}

/** "https://host:port/assets/x.js?v=1:3:9" -> "/assets/x.js:3:9" (shorter, and no address). */
export function shortenUrls(line: string): string {
  return line.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^/\s)]+/gi, "").replace(/\?[^\s):]*/g, "");
}

/** A stack frame line (V8 "at …", Firefox/Safari "fn@url:1:2", or anything ending in :line:col). */
const FRAME_LINE = /^at\s|@|:\d+:\d+\)?$/;

function stackHead(stack: unknown): string[] {
  if (typeof stack !== "string" || stack === "") return [];
  const out: string[] = [];
  for (const raw of stack.slice(0, 4000).split("\n")) {
    const line = raw.trim();
    if (!line || !FRAME_LINE.test(line)) continue;
    const clean = cleanText(shortenUrls(line), MAX_STACK_LINE_CHARS);
    if (clean) out.push(clean);
    if (out.length >= STACK_LINES) break;
  }
  return out;
}

/** The message and stack head of anything that was thrown (never throws). */
export function describeError(err: unknown): { msg: string; stack: string[] } {
  try {
    if (err !== null && typeof err === "object" && ("message" in err || "stack" in err)) {
      const e = err as { name?: unknown; message?: unknown; stack?: unknown };
      const name = typeof e.name === "string" && e.name ? e.name : "Error";
      const message = cleanText(e.message, MAX_MESSAGE_CHARS);
      const msg = cleanText(message ? `${name}: ${message}` : name, MAX_MESSAGE_CHARS);
      return { msg, stack: stackHead(e.stack) };
    }
    if (typeof err === "string") return { msg: cleanText(err, MAX_MESSAGE_CHARS) || "(empty message)", stack: [] };
    if (err === undefined || err === null) return { msg: `Thrown: ${String(err)}`, stack: [] };
    let shown = "";
    try {
      shown = typeof err === "object" ? JSON.stringify(err) : String(err);
    } catch {
      shown = Object.prototype.toString.call(err);
    }
    return { msg: cleanText(`Thrown: ${shown}`, MAX_MESSAGE_CHARS), stack: [] };
  } catch {
    return { msg: "(an error that could not be read)", stack: [] };
  }
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** One stored entry made safe, or null when it can't be one. */
export function sanitizeProblem(raw: unknown): Problem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.at) || r.at < 0) return null;
  const msg = cleanText(r.msg, MAX_MESSAGE_CHARS);
  if (!msg) return null;
  const field = (v: unknown): string => cleanText(v, MAX_FIELD_CHARS) || "?";
  return {
    at: r.at,
    last: finite(r.last) && r.last >= r.at ? r.last : r.at,
    n: finite(r.n) && r.n >= 1 ? Math.min(MAX_COUNT, Math.floor(r.n)) : 1,
    kind: KINDS.includes(r.kind as ProblemKind) ? (r.kind as ProblemKind) : "error",
    msg,
    stack: Array.isArray(r.stack)
      ? r.stack
          .slice(0, STACK_LINES)
          .map((l) => cleanText(l, MAX_STACK_LINE_CHARS))
          .filter((l) => l !== "")
      : [],
    build: field(r.build),
    screen: field(r.screen),
    quality: field(r.quality),
    edition: field(r.edition),
    online: r.online === true,
  };
}

/** The context made safe (a provider that throws or lies never breaks the log). */
export function sanitizeContext(raw: unknown): ProblemContext {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const field = (v: unknown): string => cleanText(v, MAX_FIELD_CHARS) || "?";
  return { screen: field(r.screen), quality: field(r.quality), edition: field(r.edition), online: r.online === true };
}

// ---- The list (pure) -------------------------------------------------------------

/** What a new problem brings (the count and last-seen time are the log's). */
export type NewProblem = Omit<Problem, "n" | "last">;

/**
 * The list with `p` added, newest first. An identical message already in
 * the list is counted (n + 1, last seen now) and moves to the front instead
 * of taking a second row; it keeps where and when it was first seen.
 */
export function addProblem(list: readonly Problem[], p: NewProblem): Problem[] {
  const i = list.findIndex((x) => x.msg === p.msg);
  if (i >= 0) {
    const old = list[i];
    const merged: Problem = { ...old, n: Math.min(MAX_COUNT, old.n + 1), last: Math.max(old.last, p.at) };
    return [merged, ...list.slice(0, i), ...list.slice(i + 1)].slice(0, MAX_PROBLEMS);
  }
  return [{ ...p, n: 1, last: p.at }, ...list].slice(0, MAX_PROBLEMS);
}

/** The stored list, cleaned, newest first; [] for anything missing or broken (never throws). */
export function loadProblems(store: ProblemStore | null): Problem[] {
  let raw: string | null = null;
  try {
    raw = store?.getItem(PROBLEM_LOG_KEY) ?? null;
  } catch {
    return [];
  }
  if (!raw || raw.length > MAX_STORED_CHARS * 4) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Problem[] = [];
  for (const item of parsed.slice(0, MAX_PROBLEMS * 2)) {
    const p = sanitizeProblem(item);
    if (p) out.push(p);
  }
  out.sort((a, b) => b.last - a.last);
  return out.slice(0, MAX_PROBLEMS);
}

/** JSON for storage, dropping the oldest entries until it fits MAX_STORED_CHARS. */
export function serializeProblems(list: readonly Problem[]): string {
  let keep = list.slice(0, MAX_PROBLEMS);
  let json = JSON.stringify(keep);
  while (json.length > MAX_STORED_CHARS && keep.length > 0) {
    keep = keep.slice(0, -1);
    json = JSON.stringify(keep);
  }
  return json;
}

// ---- The report a grown-up copies --------------------------------------------------

/** The report's first lines: about this device, not about one problem. */
export interface ReportHeader {
  build: string;
  /** navigator.userAgent. */
  browser: string;
  /** "390x844, pixel ratio 2". */
  screen: string;
  quality: string;
  edition: string;
  /** When the report was made (ms since the epoch). */
  now: number;
}

/** The words of the report (the sheet passes them through tr(); tests use English). */
export interface ReportWords {
  title: string;
  build: string;
  browser: string;
  screen: string;
  graphics: string;
  edition: string;
  made: string;
  none: string;
  /** "3 problems, newest first. Kept on this device only." */
  count(n: number): string;
  /** "seen 57 times, last 10:20:14 UTC" (n > 1 only). */
  seen(n: number, last: string): string;
  where: string;
  online: string;
}

export const ENGLISH_WORDS: ReportWords = {
  title: "Crown Rush problem report",
  build: "Build",
  browser: "Browser",
  screen: "Screen",
  graphics: "Graphics",
  edition: "Edition",
  made: "Made",
  none: "No problems so far!",
  count: (n) => `${n} ${n === 1 ? "problem" : "problems"}, newest first. Kept on this device only.`,
  seen: (n, last) => `seen ${n} times, last ${last}`,
  where: "Where",
  online: "online",
};

/** "2026-11-13 10:20:11 UTC" (technical lines stay in one plain form). */
export function utcStamp(ms: number): string {
  if (!finite(ms)) return "?";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "?" : `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** The plain-text report: a header about the device, then each problem (newest first). */
export function problemReport(list: readonly Problem[], h: ReportHeader, w: ReportWords = ENGLISH_WORDS): string {
  const lines = [
    w.title,
    `${w.build}: ${cleanText(h.build, MAX_FIELD_CHARS)}`,
    `${w.browser}: ${cleanText(h.browser, 300)}`,
    `${w.screen}: ${cleanText(h.screen, MAX_FIELD_CHARS)}`,
    `${w.graphics}: ${cleanText(h.quality, MAX_FIELD_CHARS)}`,
    `${w.edition}: ${cleanText(h.edition, MAX_FIELD_CHARS)}`,
    `${w.made}: ${utcStamp(h.now)}`,
    "",
  ];
  if (list.length === 0) {
    lines.push(w.none);
    return lines.join("\n");
  }
  lines.push(w.count(list.length));
  list.forEach((p, i) => {
    lines.push("");
    const seen = p.n > 1 ? ` · ${w.seen(p.n, utcStamp(p.last))}` : "";
    lines.push(`#${i + 1} ${utcStamp(p.at)}${seen} · ${p.kind}`);
    lines.push(p.msg);
    for (const s of p.stack) lines.push(`  ${s}`);
    const where = [p.screen, p.quality, p.edition, p.online ? w.online : "", p.build].filter((x) => x !== "");
    lines.push(`${w.where}: ${where.join(" · ")}`);
  });
  return lines.join("\n");
}

// ---- The page's log ----------------------------------------------------------------

function pageStore(): ProblemStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Until main.ts says more: booting, with the edition read straight from storage. */
export function bootContext(store: ProblemStore | null = pageStore()): ProblemContext {
  let edition = "unset";
  try {
    const v = store?.getItem(ARENA_THEME_KEY);
    if (v === "arabic") edition = "golden-age";
    else if (v === "normal") edition = "classic";
  } catch {
    // storage blocked
  }
  return { screen: "boot", quality: "?", edition, online: false };
}

export interface ProblemLogOpts {
  store?: () => ProblemStore | null;
  now?: () => number;
  build?: string;
  /** Run fn after ms (default setTimeout); the deferred write while errors keep coming. */
  later?: (fn: () => void, ms: number) => void;
}

/** Messages that are not problems: the gallery's deliberate stop, a browser's benign resize notice. */
const IGNORED: readonly RegExp[] = [/^Error: gallery mode$/, /ResizeObserver loop/];

/**
 * The page's problem log: an in-memory list (loaded lazily, so a broken
 * stored value costs nothing at boot) written to localStorage at most once
 * per SAVE_GAP_MS while errors keep coming. Recording never throws.
 */
export class ProblemLog {
  private items: Problem[] | null = null;
  private context: () => ProblemContext;
  private lastSave = -Infinity;
  private saveQueued = false;
  private readonly marked = new WeakSet<object>();
  private readonly listeners = new Set<() => void>();
  private readonly store: () => ProblemStore | null;
  private readonly now: () => number;
  private readonly build: string;
  private readonly later: (fn: () => void, ms: number) => void;

  constructor(opts: ProblemLogOpts = {}) {
    this.store = opts.store ?? pageStore;
    this.now = opts.now ?? (() => Date.now());
    this.build = opts.build ?? BUILD_ID;
    this.later = opts.later ?? ((fn, ms) => void setTimeout(fn, ms));
    this.context = () => bootContext(this.store());
  }

  /** Tell the log what the app is doing (main.ts, once the screens exist). */
  setContext(fn: () => ProblemContext): void {
    this.context = fn;
  }

  /** The context right now, made safe. */
  currentContext(): ProblemContext {
    try {
      return sanitizeContext(this.context());
    } catch {
      return sanitizeContext(null);
    }
  }

  /** The build id entries are stamped with. */
  get buildId(): string {
    return this.build;
  }

  /** Newest first (a copy). */
  list(): Problem[] {
    return [...this.load()];
  }

  /** Record something that went wrong. Returns its entry, or null if it was ignored. Never throws. */
  record(kind: ProblemKind, err: unknown): Problem | null {
    try {
      if (err !== null && typeof err === "object") this.marked.add(err);
      const { msg, stack } = describeError(err);
      if (IGNORED.some((re) => re.test(msg))) return null;
      this.items = addProblem(this.load(), {
        at: this.now(),
        kind,
        msg,
        stack,
        build: cleanText(this.build, MAX_FIELD_CHARS) || "?",
        ...this.currentContext(),
      });
      this.saveSoon();
      this.notify();
      return this.items[0];
    } catch {
      return null;
    }
  }

  /** This very error object was recorded already (the window listener skips a rethrown one). */
  wasRecorded(err: unknown): boolean {
    return err !== null && typeof err === "object" && this.marked.has(err);
  }

  /** Forget every entry, here and in storage. */
  clear(): void {
    this.items = [];
    try {
      const s = this.store();
      if (s?.removeItem) s.removeItem(PROBLEM_LOG_KEY);
      else s?.setItem(PROBLEM_LOG_KEY, "[]");
    } catch {
      // storage blocked: the list is empty for this page anyway
    }
    this.lastSave = this.now();
    this.notify();
  }

  /** Write now (a pending deferred write is folded in). */
  flush(): void {
    this.lastSave = this.now();
    try {
      this.store()?.setItem(PROBLEM_LOG_KEY, serializeProblems(this.load()));
    } catch {
      // storage full or blocked: the log lives on in memory for this page
    }
  }

  /** Run fn whenever the list changes; returns the unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private load(): Problem[] {
    if (this.items === null) this.items = loadProblems(this.store());
    return this.items;
  }

  private saveSoon(): void {
    const wait = this.lastSave + SAVE_GAP_MS - this.now();
    if (wait <= 0) {
      this.flush();
      return;
    }
    if (this.saveQueued) return;
    this.saveQueued = true;
    this.later(() => {
      this.saveQueued = false;
      this.flush();
    }, wait);
  }

  private notify(): void {
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        // a broken listener never stops the log
      }
    }
  }
}

/** This page's log. */
export const problemLog = new ProblemLog();
