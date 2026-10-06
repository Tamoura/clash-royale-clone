/**
 * The soundtrack as data: step tables for the menu theme and the battle
 * track, plus the pure look-ahead scheduling math the engine runs on.
 *
 * Everything here is plain numbers and strings (no Web Audio), so the
 * composition and the timing are unit-tested in node; src/audio/sound.ts
 * turns a compiled step into synthesized notes.
 *
 * Notation (one token per step, whitespace separated, '|' is ignored):
 * - a digit 1..7 is a scale degree; each '^' raises it an octave, each '_'
 *   lowers it ('^1' is the octave above the root, '_7' the leading tone below)
 * - '-' holds the previous note one more step, '.' is a rest
 * - in chord-relative lines (bass, arp) the degree counts up from the bar's
 *   chord root (1 = root, 3 = third, 5 = fifth, '^1' = root an octave up),
 *   and the bass also accepts R (root), F (fifth) and O (root an octave up)
 * - drums: K kick, S snare, D dum, T tak, lower case = ghost (soft) hit
 * - hats: x on the step, + on the half step after it, * both
 *
 * Melodies are written in scale degrees so each edition renders the same
 * tune in its own mode: Classic in major / dorian, the Islamic edition in
 * maqam Bayati (with its true quarter-tone second) and Hijaz.
 */

export type TrackId = "menu" | "battle";
export type MusicId = TrackId | "none";
export type Edition = "classic" | "arabic";
/** 0 = normal time, 1 = double elixir, 2 = overtime. */
export type Intensity = 0 | 1 | 2;

/** Semitones above the tonic for each of the 7 degrees (fractions are quarter tones). */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  bayati: [0, 1.5, 3, 5, 7, 8, 10],
  hijaz: [0, 1, 4, 5, 7, 8, 10],
} as const;
export type ScaleId = keyof typeof SCALES;

/** Synth patches, implemented in sound.ts. */
export type InstrumentId =
  | "flute" | "ney" | "brass" | "mizmar" | "pluck" | "oud" | "harp" | "qanun" | "chip" | "pad";

/** 8 steps per bar; a step is an eighth note. */
export const STEPS_PER_BAR = 8;

export interface TrackDef {
  id: TrackId;
  /** Seconds per step, by intensity. */
  stepSec: readonly [number, number, number];
  /** Frequency of degree 1 at octave 0. */
  rootHz: number;
  scale: Readonly<Record<Edition, ScaleId>>;
  /** Chord root degree (1..7) for every bar; its length sets the loop. */
  chords: readonly number[];
  /** Named sections by starting bar, for structure (and tests). */
  sections: readonly { name: string; bar: number }[];
  lead: string;
  bass: string;
  arp: string;
  /** Lowest intensity at which the arp / counter-melody layer plays. */
  arpFrom: Intensity;
  /** Octave offsets of the lead and arp layers. */
  leadOct: number;
  arpOct: number;
  pad: boolean;
  hats: string;
  hatsFrom: Intensity;
  drums: Readonly<Record<Edition, string>>;
  drumsFrom: Intensity;
  voices: Readonly<Record<Edition, { lead: InstrumentId; bass: InstrumentId; arp: InstrumentId }>>;
}

const bars = (...patterns: [string, number][]): string =>
  patterns.map(([p, n]) => Array(n).fill(p).join(" ")).join(" ");

// ---- Menu theme: 8 bars (64 steps), A then B, calm and open ---------------

const MENU: TrackDef = {
  id: "menu",
  stepSec: [0.29, 0.29, 0.29],
  rootHz: 293.66, // D4
  scale: { classic: "major", arabic: "bayati" },
  //        A: I  IV vi  V    B: IV  V vi  V
  chords: [1, 4, 6, 5, 4, 5, 6, 5],
  sections: [
    { name: "A", bar: 0 },
    { name: "B", bar: 4 },
  ],
  lead: [
    "3 - 5 - ^1 - 7 - | 6 - - 5 4 - . . | 3 - 2 - 1 - 3 - | 2 - 1 _7 2 - - .",
    "4 - 6 - ^1 - ^2 - | ^2 - ^1 - 7 - 5 - | 6 - ^1 - ^3 - ^2 ^1 | 7 - - - 5 - - .",
  ].join(" | "),
  bass: bars(["R - - . F - O .", 8]),
  arp: bars(["1 5 ^1 ^3 ^1 5 3 5", 8]),
  arpFrom: 0,
  leadOct: 0,
  arpOct: -1,
  pad: true,
  hats: "",
  hatsFrom: 0,
  drums: { classic: "", arabic: bars(["D . . t D . t .", 8]) },
  drumsFrom: 0,
  voices: {
    classic: { lead: "flute", bass: "pluck", arp: "harp" },
    arabic: { lead: "ney", bass: "oud", arp: "qanun" },
  },
};

// ---- Battle track: 16 bars (128 steps), A / B / A' / bridge --------------

const DRIVE = "R . R O R . F O";
const HOLD = "R - - - O - F -";
const COUNTER = ". 5 ^1 5 . 3 5 .";
const COUNTER_BRIDGE = "^1 . . ^1 . . 7 .";

const BATTLE: TrackDef = {
  id: "battle",
  stepSec: [0.2, 0.19, 0.168],
  rootHz: 293.66, // D4
  scale: { classic: "dorian", arabic: "hijaz" },
  chords: [
    1, 7, 4, 1, // A
    3, 7, 4, 5, // B
    1, 7, 4, 5, // A'
    4, 4, 5, 5, // bridge
  ],
  sections: [
    { name: "A", bar: 0 },
    { name: "B", bar: 4 },
    { name: "A'", bar: 8 },
    { name: "bridge", bar: 12 },
  ],
  lead: [
    // A
    "1 . 1 2 3 - 5 - | 4 - 3 2 _7 - . . | 4 . 4 5 6 - ^1 - | 7 6 5 4 5 - - .",
    // B
    "^3 - ^2 ^1 7 - 5 - | ^2 - ^1 7 ^1 - 5 - | 4 - 6 - ^1 - 6 5 | 5 - - . 7 - ^2 -",
    // A'
    "1 . 1 2 3 - 5 - | 4 - 3 2 _7 - . . | 4 . 4 5 6 - ^1 - | 5 - 7 - ^2 - ^1 7",
    // bridge
    "6 - - - 4 - - - | 6 - ^1 - ^2 - - - | 7 - - - 5 - - - | ^2 - ^1 - 7 - 6 5",
  ].join(" | "),
  bass: bars([DRIVE, 12], [HOLD, 4]),
  arp: bars([COUNTER, 12], [COUNTER_BRIDGE, 4]),
  arpFrom: 1,
  leadOct: 0,
  arpOct: 1,
  pad: false,
  hats: bars(["+ + * + + + * +", 16]),
  hatsFrom: 1,
  drums: {
    classic: bars(["K . S . K K S .", 15], ["K . S S K S S S", 1]),
    // Maqsum: dum tak . tak dum . tak .
    arabic: bars(["D T . T D . T .", 15], ["D T t T D T T T", 1]),
  },
  drumsFrom: 2,
  voices: {
    classic: { lead: "brass", bass: "pluck", arp: "chip" },
    arabic: { lead: "mizmar", bass: "oud", arp: "qanun" },
  },
};

export const TRACKS: Readonly<Record<TrackId, TrackDef>> = { menu: MENU, battle: BATTLE };

// ---- Compilation ----------------------------------------------------------

/** A note: pitch in semitones above the track root, length in steps. */
export interface Note {
  semis: number;
  len: number;
}

export interface StepEvents {
  lead?: Note;
  bass?: Note;
  arp?: Note;
  /** Chord tones held for the bar (only on the bar's first step). */
  pad?: Note[];
  hat?: "x" | "+" | "*";
  drum?: string;
}

export interface CompiledTrack {
  def: TrackDef;
  edition: Edition;
  length: number;
  steps: StepEvents[];
}

/** Degree index (0-based, any octave) to semitones in a scale. */
export function degreeSemis(scale: readonly number[], deg: number): number {
  const oct = Math.floor(deg / 7);
  return scale[deg - oct * 7] + 12 * oct;
}

/** Parse one degree token ('3', '^1', '__5') to a 0-based degree index, or null. */
export function parseDegree(tok: string): number | null {
  const m = /^([_^]*)([1-8])$/.exec(tok);
  if (!m) return null;
  let oct = 0;
  for (const c of m[1]) oct += c === "^" ? 1 : -1;
  return Number(m[2]) - 1 + oct * 7;
}

/** Split a line into step tokens ('|' bar marks dropped). */
export function tokens(line: string): string[] {
  return line.split(/\s+/).filter((t) => t !== "" && t !== "|");
}

interface RawNote {
  step: number;
  tok: string;
  len: number;
}

/** Turn a token line into notes with '-' holds folded into their lengths. */
export function parseLine(line: string): { steps: number; notes: RawNote[] } {
  const toks = tokens(line);
  const notes: RawNote[] = [];
  let open: RawNote | null = null;
  toks.forEach((tok, step) => {
    if (tok === "-") {
      if (open) open.len++;
      return;
    }
    open = null;
    if (tok === ".") return;
    open = { step, tok, len: 1 };
    notes.push(open);
  });
  return { steps: toks.length, notes };
}

/** Bass degree for a chord root (0-based), folded into the D2..C3 register. */
function bassRoot(root: number): number {
  return root - (root <= 3 ? 14 : 21);
}

/** Compile a track into one StepEvents per step for an edition. */
export function compileTrack(def: TrackDef, edition: Edition): CompiledTrack {
  const scale = SCALES[def.scale[edition]];
  const length = def.chords.length * STEPS_PER_BAR;
  const steps: StepEvents[] = Array.from({ length }, () => ({}));
  const chordAt = (step: number): number => def.chords[Math.floor(step / STEPS_PER_BAR) % def.chords.length] - 1;
  const semis = (deg: number): number => degreeSemis(scale, deg);

  for (const n of parseLine(def.lead).notes) {
    const deg = parseDegree(n.tok);
    if (deg === null || n.step >= length) continue;
    steps[n.step].lead = { semis: semis(deg + def.leadOct * 7), len: n.len };
  }
  for (const n of parseLine(def.bass).notes) {
    if (n.step >= length) continue;
    const root = bassRoot(chordAt(n.step));
    const deg =
      n.tok === "R" ? root : n.tok === "F" ? root + 4 : n.tok === "O" ? root + 7 : null;
    if (deg === null) continue;
    steps[n.step].bass = { semis: semis(deg), len: n.len };
  }
  for (const n of parseLine(def.arp).notes) {
    const rel = parseDegree(n.tok);
    if (rel === null || n.step >= length) continue;
    steps[n.step].arp = { semis: semis(chordAt(n.step) + rel + def.arpOct * 7), len: n.len };
  }
  if (def.pad) {
    for (let bar = 0; bar < def.chords.length; bar++) {
      const root = def.chords[bar] - 1 - 7;
      const r = semis(root);
      // Root, the scale's own third, and a pure fifth (never a quarter-tone fifth).
      steps[bar * STEPS_PER_BAR].pad = [r, semis(root + 2), r + 7].map((s) => ({ semis: s, len: STEPS_PER_BAR }));
    }
  }
  tokens(def.hats).forEach((t, i) => {
    if (i < length && (t === "x" || t === "+" || t === "*")) steps[i].hat = t;
  });
  tokens(def.drums[edition]).forEach((t, i) => {
    if (i < length && t !== ".") steps[i].drum = t;
  });
  return { def, edition, length, steps };
}

/** Which layers sound at an intensity (the menu ignores intensity). */
export function layersAt(def: TrackDef, level: Intensity): { arp: boolean; hats: boolean; drums: boolean } {
  const lv = def.id === "menu" ? 0 : level;
  return { arp: lv >= def.arpFrom, hats: lv >= def.hatsFrom, drums: lv >= def.drumsFrom };
}

/** Seconds per step for a track at an intensity. */
export function stepSeconds(def: TrackDef, level: Intensity): number {
  return def.stepSec[def.id === "menu" ? 0 : level];
}

// ---- Look-ahead scheduling -------------------------------------------------

/** The scheduler timer period and how far ahead it books notes. */
export const SCHEDULER_TICK_MS = 25;
export const LOOKAHEAD_SEC = 0.12;
/** The most the window stretches when the main thread is janky. */
export const MAX_LOOKAHEAD_SEC = 0.4;
/** Behind by more than this (a stalled tab), the cursor jumps to now. */
export const RESYNC_SEC = 0.3;
/** Crossfade between tracks. */
export const MUSIC_FADE_SEC = 0.4;

export interface Cursor {
  /** Next step to schedule (monotonic; wrap with % length). */
  step: number;
  /** Audio-clock time that step starts at. */
  time: number;
}

/**
 * The booking window for this pump: the nominal 0.12 s, stretched to 1.5x
 * the gap since the previous pump when timers run late (a busy frame on a
 * slow phone), so the music never runs dry between two pumps.
 */
export function lookaheadFor(gapSec: number): number {
  return Math.min(MAX_LOOKAHEAD_SEC, Math.max(LOOKAHEAD_SEC, gapSec * 1.5));
}

/**
 * Pop every step that starts before `now + lookahead`, advancing the
 * cursor by each step's own duration (so tempo changes take effect on the
 * next step). A step a little late still plays (at once); a cursor that
 * fell far behind (a stalled tab) jumps to now instead of bursting out
 * the backlog.
 */
export function dueSteps(
  cur: Cursor,
  now: number,
  lookahead: number,
  stepSec: (step: number) => number,
  maxSteps = 32,
): { step: number; time: number }[] {
  if (cur.time < now - RESYNC_SEC) cur.time = now + 0.02;
  const out: { step: number; time: number }[] = [];
  while (cur.time < now + lookahead && out.length < maxSteps) {
    out.push({ step: cur.step, time: cur.time });
    cur.time += Math.max(0.02, stepSec(cur.step));
    cur.step++;
  }
  return out;
}

/**
 * The final-seconds clock tick: given the whole seconds left at the last
 * tick (or -1), return the number to tick now, or null. Ticks once per
 * second for the last 10 seconds of regulation or overtime.
 */
export function clockTickDue(lastTicked: number, secondsLeft: number): number | null {
  if (!(secondsLeft > 0)) return null;
  const whole = Math.ceil(secondsLeft);
  if (whole > 10 || whole === lastTicked) return null;
  return whole;
}
