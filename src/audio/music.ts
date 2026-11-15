/**
 * The soundtrack as data: step tables for the menu theme and the battle
 * track ("War Drums", طبول الحرب), plus the pure look-ahead scheduling math
 * the engine runs on.
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
 * - drums: one letter per drum (a token of several letters strikes them
 *   together), lower case = ghost (soft) stroke:
 *   - darbuka (the menu): D dum, T tak
 *   - Classic war drums: B big war drum, L low war tom, H high war tom,
 *     S snare, R snare roll (fills its step), C stick / rim click
 *   - Golden Age war drums: U tabl dum, A tabl tak, N naqqara low, Q naqqara
 *     high, Z naqqara roll (fills its step), F daf
 * - hats: x on the step, + on the half step after it, * both (Classic plays
 *   a closed hat, the Golden Age edition the jingles of a riq)
 *
 * Melodies are written in scale degrees so each edition renders the same
 * tune in its own mode: Classic in major / dorian, the Golden Age edition
 * in maqam Bayati (with its true quarter-tone second) and Hijaz.
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
  | "flute" | "ney" | "brass" | "mizmar" | "pluck" | "oud" | "harp" | "qanun" | "pad"
  | "horn" | "nafir" | "drone" | "arghul";

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
  /**
   * How much of its written length a bass note sounds (default 0.9, a
   * detached bass); above 1 a drone overlaps its next note, so it never dips.
   */
  bassGate?: number;
  hats: string;
  hatsFrom: Intensity;
  /** The groove: the drum line each edition plays from `drumsFrom` up. */
  drums: Readonly<Record<Edition, string>>;
  drumsFrom: Intensity;
  /** Drums that answer the groove in its gaps (toms, naqqara), from `answersFrom` up. */
  answers?: Readonly<Record<Edition, string>>;
  answersFrom?: Intensity;
  /** Rolls into each phrase and section, from `rollsFrom` up. */
  rolls?: Readonly<Record<Edition, string>>;
  rollsFrom?: Intensity;
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

// ---- Battle track: "War Drums" (طبول الحرب), 32 bars (256 steps) ----------
//
// A heroic army marching into battle. The drums are the star from the first
// beat at every intensity; short horn calls ring out over them with space
// between, on a low drone. Five sections, each ending its 4-bar phrases with
// a drum fill (bars 4, 8, 12 ... of the loop):
//
//   call   (bars 1-8)   the horn calls twice; the drums answer each call.
//   march  (bars 9-16)  a march tune over a steady stomp; the drone moves to
//                       the fourth for two bars to lift it.
//   answer (bars 17-24) call and response: horn, then drums (and from double
//                       elixir the second horn) answer.
//   break  (bars 25-28) drums and drone alone, three big strokes a bar for
//                       kids to stomp to (3 + 3 + 2).
//   charge (bars 29-32) the horn climbs the chord to its top note, and a fill
//                       leads back to the call.
//
// Classic: big war drum, war toms, snare and stick clicks under a war horn
// and a brass answer, in D dorian over a low drone (root and fifth).
// Golden Age: the same structure on Arab war drums: tabl (deep dum, sharp
// tak), a naqqara pair, daf and riq jingles, under nafir calls and a mizmar
// answer in maqam Hijaz on D, over an arghul drone. Its grooves are real Arab
// rhythms: Maqsum in the call, Saidi in the march, Baladi in the answer,
// Malfuf (3 + 3 + 2) in the break and Maqsum with ghost taks in the charge.
//
// Intensity: normal time is groove + drone + horn calls; double elixir adds
// the answering drums (toms / naqqara and daf), hats or riq jingles and the
// second horn; overtime is faster and adds rolls into every phrase.

/** Repeat one bar `n` times. */
const rep = (bar: string, n: number): string[] => Array<string>(n).fill(bar);
const REST = ". . . . . . . .";

/** The horn calls, in scale degrees: short phrases with space between them. */
const WAR_LEAD = [
  // call: two calls, each answered by the drums
  "1 . 1 5 - - - .", "^1 - - - 5 - . .", REST, REST,
  "1 . 1 5 - - 6 5", "4 - 3 - 1 - - .", REST, REST,
  // march
  "1 . 1 . 3 . 4 .", "5 - - - . . . .", "4 . 4 . 3 . 2 .", "1 - - - . . . .",
  "5 . 5 . 6 . 7 .", "^1 - - - 5 - . .", "6 . 5 . 4 . 3 .", "5 - - - . . . .",
  // answer: the horn calls on the even bars, rests on the odd ones
  "^1 . ^1 . 5 - - .", REST, "6 . 6 . 4 - - .", REST,
  "5 . 5 6 7 - - .", "^1 - - - . . . .", "7 . 6 . 5 . 4 .", "5 - - - . . . .",
  // break: drums alone
  ...rep(REST, 4),
  // charge
  "1 . 3 . 5 . ^1 .", "^1 - - - - - . .", "6 . 5 . 4 . 3 .", "5 - - - . . . .",
];

/** The second horn, chord-relative: it answers the calls and harmonises the charge. */
const WAR_ANSWER = [
  // call
  REST, REST, "5 . 5 4 - - 3 -", "1 - - - . . . .",
  REST, REST, "5 . 5 6 - - 5 -", "^1 - - - . . . .",
  // march: answers in the lead's rests
  REST, ". . . . 3 . 2 1", REST, ". . . . 5 . 4 .",
  REST, ". . . . . . 1 -", REST, ". . . . 5 4 3 2",
  // answer: echoes each call
  REST, "5 . 5 . 1 - - .", REST, "3 . 3 . 1 - - .",
  REST, ". . . . 5 6 5 .", REST, ". . . . 3 . 1 .",
  // break
  ...rep(REST, 4),
  // charge: thirds and fourths under the lead
  "_5 . 1 . 3 . 5 .", "5 - - - - - . .", "1 . _7 . _6 . _5 .", "3 - - - . . . .",
];

/** The drone: root and fifth (the patch sounds the fifth), mostly held two bars. */
const DRONE2 = "R - - - - - - - - - - - - - - -";
const DRONE1 = "R - - - - - - -";

// Classic grooves (B big drum, S snare, C stick click; lower case = ghost).
const C_CALL = "B . . B B . C ."; // boom . . boom boom . click .
const C_REPLY = "B . C . B B C ."; // the drums answer a call
const C_MARCH = "B . S s B B S .";
const C_HORN = "B . C . B . C ."; // light under a horn call
const C_ECHO = "B B S . B B S ."; // the drums' answer
const C_BREAK = "B . . B . . B ."; // three big strokes, 3 + 3 + 2
const C_CHARGE = "B . S . B . S .";

// Golden Age grooves on the tabl (U dum, A tak; lower case = ghost).
const G_MAQSUM = "U A . A U . A ."; // Maqsum: dum tak . tak dum . tak .
const G_MAQSUM_REPLY = "U A a A U U A .";
const G_SAIDI = "U A . U U . A ."; // Saidi: dum tak . dum dum . tak .
const G_BALADI = "U U . A U . A ."; // Baladi: dum dum . tak dum . tak .
const G_MALFUF = "U . . A . . A ."; // Malfuf: dum . . tak . . tak . (3 + 3 + 2)
const G_DRIVE = "U A a A U a A a"; // Maqsum with ghost taks

/**
 * The groove, from normal time up. The last bar of every 4-bar phrase is a
 * fill (bars 3, 7, 11 ... counting from 0), at the same places in both
 * editions.
 */
const WAR_DRUMS: Record<Edition, string[]> = {
  classic: [
    C_CALL, C_CALL, C_REPLY, "B . S . S S S S",
    C_CALL, C_CALL, C_REPLY, "B . B . S S S S",
    C_MARCH, C_MARCH, C_MARCH, "B . S S B S S S",
    C_MARCH, C_MARCH, C_MARCH, "B S S . S S S S",
    C_HORN, C_ECHO, C_HORN, "B B S . S S S S",
    C_HORN, C_ECHO, C_HORN, "B . B . B B B B",
    C_BREAK, C_BREAK, C_BREAK, "B . B . S S S S",
    C_CHARGE, "B . S . B . S S", C_CHARGE, "B . S S B S S S",
  ],
  arabic: [
    G_MAQSUM, G_MAQSUM, G_MAQSUM_REPLY, "U . A . A A A A",
    G_MAQSUM, G_MAQSUM, G_MAQSUM_REPLY, "U . U . A A A A",
    G_SAIDI, G_SAIDI, G_SAIDI, "U A . U U A A A",
    G_SAIDI, G_SAIDI, G_SAIDI, "U A A . A A A A",
    G_BALADI, G_BALADI, G_BALADI, "U U . A A A A A",
    G_BALADI, G_BALADI, G_BALADI, "U . U . U U U U",
    G_MALFUF, G_MALFUF, G_MALFUF, "U . U . A A A A",
    G_DRIVE, G_DRIVE, G_DRIVE, "U . A A U A A A",
  ],
};

/** Answering drums (double elixir up): war toms / naqqara and daf in the groove's gaps. */
const C_FILL_TOMS = ". H . H . . . .";
const G_FILL_NAQ = ". Q . N . . . .";
const WAR_ANSWERS: Record<Edition, string[]> = {
  classic: [
    ...rep(". . L . . H . H", 3), C_FILL_TOMS,
    ...rep(". . L . . H . H", 3), C_FILL_TOMS,
    ...rep(". H . . . . . L", 3), C_FILL_TOMS,
    ...rep(". H . . . . . L", 3), C_FILL_TOMS,
    ". . . H . . . H", ". . . L . . . L", ". . . H . . . H", C_FILL_TOMS,
    ". . . H . . . H", ". . . L . . . L", ". . . H . . . H", C_FILL_TOMS,
    ...rep(". H L . H L . L", 3), C_FILL_TOMS,
    ...rep(". L . L . H . H", 3), C_FILL_TOMS,
  ],
  arabic: [
    ...rep(". . Q . . N . Q", 3), G_FILL_NAQ,
    ...rep(". . Q . . N . Q", 3), G_FILL_NAQ,
    ...rep("F . Q . F N . Q", 3), G_FILL_NAQ,
    ...rep("F . Q . F N . Q", 3), G_FILL_NAQ,
    ...rep(". . N . . Q . Q", 3), G_FILL_NAQ,
    ...rep(". . N . . Q . Q", 3), G_FILL_NAQ,
    ...rep("F Q N . Q N . Q", 3), G_FILL_NAQ,
    ...rep("F Q . N F Q . N", 3), G_FILL_NAQ,
  ],
};

/** Overtime rolls: into every phrase, longer into every section. */
const rollsFor = (r: string): string[] => {
  const into = (n: number): string => `${". ".repeat(8 - n)}${`${r} `.repeat(n)}`.trim();
  return [
    ...rep(REST, 3), into(1), ...rep(REST, 3), into(2), // call
    ...rep(REST, 3), into(1), ...rep(REST, 3), into(2), // march
    ...rep(REST, 3), into(1), ...rep(REST, 3), into(2), // answer
    ...rep(REST, 3), into(4), // break
    ...rep(REST, 3), into(2), // charge
  ];
};

const BATTLE: TrackDef = {
  id: "battle",
  // Eighth notes at 130, 140 and 154 beats a minute.
  stepSec: [0.23, 0.215, 0.195],
  rootHz: 293.66, // D4
  scale: { classic: "dorian", arabic: "hijaz" },
  chords: [
    1, 1, 1, 1, 1, 1, 1, 1, // call
    1, 1, 1, 1, 4, 4, 1, 1, // march
    1, 1, 4, 4, 1, 1, 4, 1, // answer
    1, 1, 1, 1, // break
    1, 1, 4, 1, // charge
  ],
  sections: [
    { name: "call", bar: 0 },
    { name: "march", bar: 8 },
    { name: "answer", bar: 16 },
    { name: "break", bar: 24 },
    { name: "charge", bar: 28 },
  ],
  lead: WAR_LEAD.join(" | "),
  bass: [
    ...rep(DRONE2, 11), // bars 1-22
    DRONE1, DRONE1, // bars 23-24: G then D
    ...rep(DRONE2, 3), // bars 25-30
    DRONE1, DRONE1, // bars 31-32: G then D
  ].join(" | "),
  arp: WAR_ANSWER.join(" | "),
  arpFrom: 1,
  leadOct: 0,
  arpOct: 0,
  pad: false,
  bassGate: 1.05,
  hats: [
    ...rep("x . x . x . x .", 8), // call
    ...rep("x . x x x . x x", 8), // march
    ...rep("x . x . x . x .", 12), // answer, break
    ...rep("x . x x x . x x", 4), // charge
  ].join(" | "),
  hatsFrom: 1,
  drums: { classic: WAR_DRUMS.classic.join(" | "), arabic: WAR_DRUMS.arabic.join(" | ") },
  drumsFrom: 0,
  answers: { classic: WAR_ANSWERS.classic.join(" | "), arabic: WAR_ANSWERS.arabic.join(" | ") },
  answersFrom: 1,
  rolls: { classic: rollsFor("R").join(" | "), arabic: rollsFor("Z").join(" | ") },
  rollsFrom: 2,
  voices: {
    classic: { lead: "horn", bass: "drone", arp: "brass" },
    arabic: { lead: "nafir", bass: "arghul", arp: "mizmar" },
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
  /** Drum tokens: the groove, the answering drums and the rolls. */
  drum?: string;
  answer?: string;
  roll?: string;
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
  const drumLine = (line: string | undefined, key: "drum" | "answer" | "roll"): void =>
    tokens(line ?? "").forEach((t, i) => {
      if (i < length && t !== ".") steps[i][key] = t;
    });
  drumLine(def.drums[edition], "drum");
  drumLine(def.answers?.[edition], "answer");
  drumLine(def.rolls?.[edition], "roll");
  return { def, edition, length, steps };
}

export interface Layers {
  arp: boolean;
  hats: boolean;
  drums: boolean;
  answers: boolean;
  rolls: boolean;
}

/** Which layers sound at an intensity (the menu ignores intensity). */
export function layersAt(def: TrackDef, level: Intensity): Layers {
  const lv = def.id === "menu" ? 0 : level;
  return {
    arp: lv >= def.arpFrom,
    hats: lv >= def.hatsFrom,
    drums: lv >= def.drumsFrom,
    answers: def.answers !== undefined && lv >= (def.answersFrom ?? 0),
    rolls: def.rolls !== undefined && lv >= (def.rollsFrom ?? 0),
  };
}

/**
 * How loud the hushed bed plays, relative to its normal level: a little
 * softer (War Drums' drone is already its quietest layer).
 */
export const HUSH_LEVEL = 0.85;

/**
 * The layers a track keeps while the game waits on the player (a tutorial
 * step holding the clock): only its quietest bed, the pad where the track
 * has one, else the bass line, which in War Drums is the drone (root and
 * fifth, re-struck every bar or two). No horns, second horn, hats, drums,
 * answering drums or rolls, whatever the intensity: the army waits on the
 * drone and marches again from the next step after the kid plays. Existing
 * material only: nothing new is played.
 */
export function hushedLayers(def: TrackDef): {
  lead: boolean;
  bass: boolean;
  pad: boolean;
  arp: boolean;
  hats: boolean;
  drums: boolean;
} {
  return { lead: false, bass: !def.pad, pad: def.pad, arp: false, hats: false, drums: false };
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
/** The ramp a track starts on from silence (its first note is 0.05 s in). */
export const MUSIC_START_SEC = 0.01;

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
