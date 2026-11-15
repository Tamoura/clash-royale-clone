import { ARENA_WIDTH, type Side } from "../game/arena";
import type { BattleEvent } from "../game/battle";
import { getCard, type CardId } from "../game/cards";
import { ARABIC } from "../render3d/theme";
import { getPrefs, onPrefs, setPrefs, type Prefs } from "../ui/prefs";
import {
  HUSH_LEVEL,
  MAX_LOOKAHEAD_SEC,
  MUSIC_FADE_SEC,
  MUSIC_START_SEC,
  SCHEDULER_TICK_MS,
  STEPS_PER_BAR,
  TRACKS,
  compileTrack,
  dueSteps,
  hushedLayers,
  layersAt,
  lookaheadFor,
  stepSeconds,
  type CompiledTrack,
  type Cursor,
  type Edition,
  type InstrumentId,
  type Intensity,
  type MusicId,
  type Note,
  type TrackId,
} from "./music";

export type { Intensity, MusicId } from "./music";

/**
 * Music tempo per intensity level (0 = normal time, 1 = double elixir,
 * 2 = overtime), in milliseconds per battle-track step.
 */
export const MUSIC_STEP_MS: readonly number[] = TRACKS.battle.stepSec.map((s) => Math.round(s * 1000));

/** Deploy thump frequency: pricier cards land deeper. */
export function deployPitch(cost: number): number {
  return 500 - cost * 38;
}

// ---- Pure mixing rules (unit-tested) ---------------------------------------

/** Headroom: full sliders land at these bus levels. */
const MASTER_LEVEL = 0.5;
const MUSIC_LEVEL = 0.5;
const SFX_LEVEL = 1.25;

/** Bus gains for a set of prefs; muted silences the master only. */
export function busGains(p: Pick<Prefs, "master" | "music" | "sfx" | "muted">): {
  master: number;
  music: number;
  sfx: number;
} {
  return {
    master: p.muted ? 0 : p.master * MASTER_LEVEL,
    music: p.music * MUSIC_LEVEL,
    sfx: p.sfx * SFX_LEVEL,
  };
}

/** Music ducks this many decibels under stings and results. */
export const DUCK_DB = -8;
export const DUCK_GAIN = Math.pow(10, DUCK_DB / 20);
export const DUCK_SEC = 0.2;
/** Stereo spread: battle sounds pan with their x, never hard left/right. */
export const PAN_LIMIT = 0.6;

/**
 * Stereo position for an arena x. The online guest plays the 'enemy' side
 * with a mirrored camera, so its left is the host's right.
 */
export function panFor(x: number, localSide: Side): number {
  if (!Number.isFinite(x)) return 0;
  const p = (x / ARENA_WIDTH) * 2 - 1;
  const v = localSide === "enemy" ? -p : p;
  return Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, v)) || 0;
}

/** The card-wave-3 cues a battle event plays (null: none of these). */
export type WaveCue = "dig" | "pop" | "whoosh" | "boom" | "crumble" | "crumble-small" | "grind";

/**
 * Which new-card sound an event makes: the Digger digging in on its play
 * and popping out on 'emerge'; the Comet whooshing in on its cast and
 * booming on 'spell-land'; a Stone Golem grinding onto the field and
 * crumbling when it falls (its pebbles crumble smaller).
 */
export function waveCue(ev: BattleEvent): WaveCue | null {
  switch (ev.type) {
    case "deploy":
      if (ev.cardId === "digger") return "dig";
      if (ev.cardId === "stone-golem") return "grind";
      return null;
    case "emerge":
      return "pop";
    case "spell": {
      const card = getCard(ev.cardId);
      return card.kind === "spell" && (card.landDelay ?? 0) > 0 ? "whoosh" : null;
    }
    case "spell-land":
      return "boom";
    case "death":
      if (ev.cardId === "stone-golem") return "crumble";
      if (ev.cardId === "pebble-golem") return "crumble-small";
      return null;
    default:
      return null;
  }
}

/** A crown taken by the local side is a triumph; one taken from it is a loss. */
export function crownCue(winner: Side, localSide: Side): "cheer" | "groan" {
  return winner === localSide ? "cheer" : "groan";
}

/** The end-of-match jingle from the local player's point of view. */
export function jingleFor(winner: Side | "draw", localSide: Side): "win" | "lose" | "draw" {
  if (winner === "draw") return "draw";
  return winner === localSide ? "win" : "lose";
}

// ---- Synth patches ----------------------------------------------------------

type Wave = OscillatorType;

interface Patch {
  wave: Wave;
  /** Optional second oscillator: its wave, octave offset, detune and mix. */
  wave2?: Wave;
  oct2?: number;
  detune2?: number;
  mix2?: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Lowpass cutoff (Hz), how far above it the note starts, and resonance. */
  cutoff: number;
  cutoffEnv: number;
  q: number;
  vibrato?: { rate: number; cents: number; delay: number };
  gain: number;
}

const PATCHES: Record<InstrumentId, Patch> = {
  flute: { wave: "triangle", wave2: "sine", oct2: 1, mix2: 0.25, attack: 0.04, decay: 0.2, sustain: 0.75, release: 0.18, cutoff: 2600, cutoffEnv: 0.3, q: 0.7, vibrato: { rate: 5, cents: 9, delay: 0.18 }, gain: 0.2 },
  ney: { wave: "sine", wave2: "triangle", oct2: 0, detune2: 4, mix2: 0.45, attack: 0.07, decay: 0.25, sustain: 0.8, release: 0.22, cutoff: 2200, cutoffEnv: 0.2, q: 0.7, vibrato: { rate: 5.5, cents: 16, delay: 0.14 }, gain: 0.22 },
  brass: { wave: "sawtooth", wave2: "sawtooth", oct2: 0, detune2: 8, mix2: 0.7, attack: 0.025, decay: 0.16, sustain: 0.65, release: 0.09, cutoff: 950, cutoffEnv: 2.2, q: 1.6, gain: 0.144 },
  mizmar: { wave: "sawtooth", wave2: "square", oct2: 0, detune2: -6, mix2: 0.35, attack: 0.02, decay: 0.14, sustain: 0.7, release: 0.08, cutoff: 1500, cutoffEnv: 1.3, q: 3.5, vibrato: { rate: 6.2, cents: 22, delay: 0.09 }, gain: 0.139 },
  pluck: { wave: "triangle", wave2: "sine", oct2: -1, mix2: 0.6, attack: 0.005, decay: 0.2, sustain: 0.35, release: 0.08, cutoff: 700, cutoffEnv: 2, q: 1, gain: 0.34 },
  oud: { wave: "sawtooth", wave2: "triangle", oct2: -1, mix2: 0.5, attack: 0.003, decay: 0.14, sustain: 0.18, release: 0.1, cutoff: 520, cutoffEnv: 3.2, q: 2.6, gain: 0.38 },
  harp: { wave: "triangle", attack: 0.004, decay: 0.32, sustain: 0.12, release: 0.25, cutoff: 3200, cutoffEnv: 0.5, q: 0.7, gain: 0.1 },
  qanun: { wave: "triangle", wave2: "sawtooth", oct2: 0, detune2: 3, mix2: 0.3, attack: 0.003, decay: 0.16, sustain: 0.08, release: 0.14, cutoff: 2800, cutoffEnv: 1.2, q: 1.2, gain: 0.1 },
  pad: { wave: "sine", wave2: "triangle", oct2: 0, detune2: 7, mix2: 0.5, attack: 0.45, decay: 0.6, sustain: 0.8, release: 0.9, cutoff: 1300, cutoffEnv: 0.1, q: 0.6, gain: 0.05 },
  // War Drums. A war horn: a swelling, round brass call with a soft octave below.
  horn: { wave: "sawtooth", wave2: "triangle", oct2: -1, mix2: 0.45, attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.16, cutoff: 1600, cutoffEnv: 1.1, q: 1.1, vibrato: { rate: 5, cents: 7, delay: 0.25 }, gain: 0.146 },
  // The nafir, a long straight trumpet: brighter and more nasal, with a wider vibrato.
  nafir: { wave: "sawtooth", wave2: "square", oct2: 0, detune2: 5, mix2: 0.35, attack: 0.035, decay: 0.22, sustain: 0.72, release: 0.12, cutoff: 1800, cutoffEnv: 1, q: 2.4, vibrato: { rate: 5.6, cents: 14, delay: 0.2 }, gain: 0.143 },
  // Drones: one note sounds its root and a pure fifth (702 cents) above it.
  drone: { wave: "sawtooth", wave2: "sawtooth", oct2: 0, detune2: 702, mix2: 0.6, attack: 0.4, decay: 0.9, sustain: 0.85, release: 0.5, cutoff: 600, cutoffEnv: 0.25, q: 0.8, gain: 0.065 },
  // The arghul's reedy drone pipe.
  arghul: { wave: "square", wave2: "sawtooth", oct2: 0, detune2: 702, mix2: 0.5, attack: 0.35, decay: 0.9, sustain: 0.85, release: 0.5, cutoff: 750, cutoffEnv: 0.2, q: 1.8, gain: 0.052 },
};

/** Per-layer levels on top of each patch's own gain. */
const LAYER = { lead: 1, bass: 0.9, arp: 0.85, pad: 1, hat: 0.05, drum: 0.55 } as const;

/**
 * Drum levels per track, relative to LAYER.drum: the menu's soft darbuka,
 * and War Drums' groove (by intensity: it plays harder in overtime), its
 * answering drums and its overtime rolls and ghost strokes.
 */
const KIT = { menu: 0.45, groove: [1, 1, 1.12], answers: 0.8, rolls: 0.9 } as const;

/**
 * War Drums' strokes are not all alike, as a drummer's are not. Beats sit
 * above the off-steps; a bar's downbeat is struck harder, which on a drum
 * means a louder stick slap (+1.5 dB) and a touch higher pitch, not more
 * low boom over the game's thumps; and every stroke varies a little in
 * level (+/-4%) and pitch (+/-2.4%) in fixed patterns that do not line up
 * with the bar, so two bars of the same groove never sound quite the same.
 * No randomness.
 */
const STEP_ACCENT = [1, 0.9, 1, 0.92, 1.04, 0.9, 1, 0.92] as const;
export interface Accent {
  level: number;
  tune: number;
  slap: number;
}
export function strokeAccent(step: number): Accent {
  const downbeat = step % STEPS_PER_BAR === 0;
  return {
    level: STEP_ACCENT[step % STEPS_PER_BAR] * (1 + 0.04 * (((step * 7) % 3) - 1)),
    tune: (downbeat ? 1.02 : 1) * (1 + 0.012 * (((step * 3) % 5) - 2)),
    slap: downbeat ? 1.19 : 1,
  };
}
const NO_ACCENT: Accent = { level: 1, tune: 1, slap: 1 };

interface Deck {
  id: TrackId;
  track: CompiledTrack;
  gain: GainNode;
  cursor: Cursor;
}

type Rarity = "common" | "rare" | "epic" | "legendary" | (string & {});

let instance: SoundEngine | null = null;

/** The app's sound engine (the first one constructed), created on demand. */
export function soundEngine(): SoundEngine {
  return instance ?? new SoundEngine();
}

/** The engine if one exists yet (wiring never forces one into existence). */
export function existingSoundEngine(): SoundEngine | null {
  return instance;
}

/**
 * Fully synthesized game audio (Web Audio API) — no audio files.
 *
 * Routing: voices → sfx bus (panned per event) / music bus (→ duck) →
 * master → limiter → speakers. Bus levels follow the player's prefs.
 * Music runs on a look-ahead scheduler against the audio clock, so tempo
 * stays rock-steady no matter how busy the main thread gets.
 *
 * Call resume() from a user gesture to unlock audio; music follows
 * playMusic(), which src/audio/wire.ts drives from the screen and match hooks.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  /** Where one-shots go: the sfx bus, or the current event's panner. */
  private out: AudioNode | null = null;
  private noiseWhite: AudioBuffer | null = null;
  private noiseBrown: AudioBuffer | null = null;
  /** The drum skins' waveform (a fundamental and three overtones), made once. */
  private drumWave: PeriodicWave | null = null;
  private lastPlayed = new Map<string, number>();
  private wanted: MusicId = "none";
  private deck: Deck | null = null;
  private compiled = new Map<TrackId, CompiledTrack>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Audio-clock time of the previous scheduler pump (-1: none yet). */
  private lastPump = -1;
  private hiddenSuspend = false;
  private duckHeld = false;
  private localSide: Side = "player";
  readonly edition: Edition;
  intensity: Intensity = 0;
  /** Notes booked by the music scheduler (a test/debug counter). */
  notesScheduled = 0;
  /** Drum strokes booked by the music scheduler (a test/debug counter). */
  drumHits = 0;
  private hushOn = false;

  constructor(opts: { edition?: Edition } = {}) {
    this.edition = opts.edition ?? (ARABIC ? "arabic" : "classic");
    if (!instance) instance = this;
    onPrefs((p) => this.applyVolumes(p));
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => this.onVisibility());
    }
  }

  // ---- Lifecycle -------------------------------------------------------------

  private ensure(): AudioContext | null {
    if (typeof AudioContext === "undefined") return null;
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      this.ctx = ctx;
      // A gentle limiter so a big fight never clips.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 10;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      limiter.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.connect(limiter);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.duckGain = ctx.createGain();
      this.duckGain.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.connect(this.duckGain);
      // A soft hall echo on the music only.
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.29;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.28;
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 2200;
      const wet = ctx.createGain();
      wet.gain.value = 0.2;
      this.musicBus.connect(delay);
      delay.connect(tone).connect(feedback).connect(delay);
      tone.connect(wet).connect(this.duckGain);
      this.noiseWhite = this.makeNoise(ctx, false);
      this.noiseBrown = this.makeNoise(ctx, true);
      if (typeof ctx.createPeriodicWave === "function") {
        // Sine partials 1..4: a fundamental the phone can't play much of,
        // and the overtones (2x to 4x, 130-500 Hz) it can.
        this.drumWave = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.8, 0.55, 0.3]));
      }
      this.out = this.sfxBus;
      this.applyVolumes(getPrefs(), true);
      ctx.addEventListener("statechange", () => this.syncMusic());
    }
    return this.ctx;
  }

  /** Two seconds of white or brown noise, made once and reused by every hit. */
  private makeNoise(ctx: AudioContext, brown: boolean): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = w;
      }
    }
    return buffer;
  }

  /**
   * Unlock audio from a user gesture. Only resumes the AudioContext: music
   * is whatever playMusic() last asked for, and starts once audio runs.
   */
  resume(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === "suspended" && !this.hiddenSuspend) {
      void ctx.resume().then(() => this.syncMusic(), () => undefined);
    } else {
      this.syncMusic();
    }
  }

  /** The current music request ('none' while silent). */
  get music(): MusicId {
    return this.wanted;
  }

  /** True while audio is unlocked and the music scheduler is booking notes. */
  get musicRunning(): boolean {
    return this.timer !== null && this.deck !== null;
  }

  private onVisibility(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.hidden) {
      this.stopTimer();
      if (ctx.state === "running") {
        this.hiddenSuspend = true;
        void ctx.suspend().catch(() => undefined);
      }
    } else if (this.hiddenSuspend) {
      this.hiddenSuspend = false;
      void ctx.resume().then(() => this.syncMusic(), () => undefined);
    }
  }

  // ---- Volumes ---------------------------------------------------------------

  get muted(): boolean {
    return getPrefs().muted;
  }

  /** Mute or unmute (persisted in prefs, so it survives a reload). */
  setMuted(muted: boolean): void {
    if (muted !== getPrefs().muted) setPrefs({ muted });
  }

  private applyVolumes(p: Readonly<Prefs>, instant = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.musicBus || !this.sfxBus) return;
    const g = busGains(p);
    const set = (param: AudioParam, v: number): void => {
      if (instant) param.setValueAtTime(v, ctx.currentTime);
      else param.setTargetAtTime(v, ctx.currentTime, 0.04);
    };
    set(this.master.gain, g.master);
    set(this.musicBus.gain, g.music);
    set(this.sfxBus.gain, g.sfx);
  }

  /** Hold the music 8 dB down (results, reveals) until duck(false). */
  duck(on: boolean): void {
    this.duckHeld = on;
    this.rampDuck(on ? DUCK_GAIN : 1, 0);
  }

  /** Dip the music under a sting for `sec`, unless a hold is on. */
  private duckFor(sec: number): void {
    if (this.duckHeld || !this.ctx) return;
    this.rampDuck(DUCK_GAIN, 0);
    this.rampDuck(1, sec);
  }

  private rampDuck(target: number, after: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.duckGain) return;
    const g = this.duckGain.gain;
    const t = ctx.currentTime + after;
    if (after === 0) g.cancelScheduledValues(t);
    g.setTargetAtTime(target, t, DUCK_SEC / 3);
  }

  // ---- Music -------------------------------------------------------------------

  /** Switch the soundtrack with a 0.4 s crossfade; 'none' fades to silence. */
  playMusic(id: MusicId): void {
    this.wanted = id;
    this.syncMusic();
  }

  /** Fade the music out (the next playMusic starts its track from the top). */
  stopMusic(): void {
    this.playMusic("none");
  }

  /** A new match is about to begin: silence until the countdown ends. */
  restartMusic(): void {
    this.playMusic("none");
  }

  /**
   * Raise or lower musical tension (0 normal, 1 double elixir, 2 overtime).
   * The battle track picks it up on its next step: answering drums, hats
   * or riq jingles and the second horn at 1, rolls and a faster tempo at 2.
   */
  setIntensity(level: Intensity): void {
    this.intensity = level;
  }

  /** True while the battle track plays only its quiet bed (see setHushed). */
  get hushed(): boolean {
    return this.hushOn;
  }

  /**
   * Drop the battle track to its quietest layer while the game waits on
   * the player (a tutorial step holding the clock), and bring the rest back
   * from the next step when play resumes. It keeps its place in the tune;
   * the menu theme never hushes.
   */
  setHushed(on: boolean): void {
    this.hushOn = on;
  }

  private track(id: TrackId): CompiledTrack {
    let t = this.compiled.get(id);
    if (!t) {
      t = compileTrack(TRACKS[id], this.edition);
      this.compiled.set(id, t);
    }
    return t;
  }

  /** Reconcile the playing deck with the request, then (re)arm the timer. */
  private syncMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    let replacing = false;
    if (this.deck && this.deck.id !== this.wanted) {
      replacing = true;
      const old = this.deck;
      this.deck = null;
      const t = ctx.currentTime;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + MUSIC_FADE_SEC);
      setTimeout(() => old.gain.disconnect(), (MUSIC_FADE_SEC + MAX_LOOKAHEAD_SEC + 1.5) * 1000);
    }
    const running = ctx.state === "running" && !(typeof document !== "undefined" && document.hidden);
    if (!this.deck && this.wanted !== "none" && running) {
      const t = ctx.currentTime;
      const gain = ctx.createGain();
      // Crossfade from a track it replaces, and fade the menu theme in. Only
      // the battle track starting from silence (after the countdown) skips
      // the fade, so its first beat lands at full strength: every note has
      // its own envelope, so nothing clicks.
      const quick = !replacing && this.wanted === "battle";
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + (quick ? MUSIC_START_SEC : MUSIC_FADE_SEC));
      gain.connect(this.musicBus);
      this.deck = { id: this.wanted, track: this.track(this.wanted), gain, cursor: { step: 0, time: t + 0.05 } };
    }
    if (this.deck && running) this.startTimer();
    else this.stopTimer();
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.lastPump = -1;
    this.timer = setInterval(() => this.pump(), SCHEDULER_TICK_MS);
    this.pump();
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Book every step that starts within the look-ahead window. */
  private pump(): void {
    const ctx = this.ctx;
    const deck = this.deck;
    if (!ctx || !deck) return;
    const def = deck.track.def;
    const now = ctx.currentTime;
    const horizon = lookaheadFor(this.lastPump < 0 ? 0 : now - this.lastPump);
    this.lastPump = now;
    const due = dueSteps(deck.cursor, now, horizon, () => stepSeconds(def, this.intensity));
    for (const { step, time } of due) this.playStep(deck, step % deck.track.length, time);
  }

  private playStep(deck: Deck, step: number, t: number): void {
    if (this.muted) return; // keep time, spend no nodes
    const ev = deck.track.steps[step];
    const def = deck.track.def;
    const sec = stepSeconds(def, this.intensity);
    const voices = def.voices[this.edition];
    const layers = layersAt(def, this.intensity);
    const hz = (n: Note): number => def.rootHz * Math.pow(2, n.semis / 12);
    const out = deck.gain;
    const bassLen = (n: Note): number => n.len * sec * (def.bassGate ?? 0.9);
    if (this.hushOn && def.id === "battle") {
      const q = hushedLayers(def);
      if (ev.bass && q.bass) this.voice(voices.bass, hz(ev.bass), t, bassLen(ev.bass), LAYER.bass * HUSH_LEVEL, out);
      if (ev.pad && q.pad) for (const n of ev.pad) this.voice("pad", hz(n), t, n.len * sec, LAYER.pad * HUSH_LEVEL, out);
      return;
    }
    if (ev.lead) this.voice(voices.lead, hz(ev.lead), t, ev.lead.len * sec, LAYER.lead, out);
    if (ev.bass) this.voice(voices.bass, hz(ev.bass), t, bassLen(ev.bass), LAYER.bass, out);
    if (ev.arp && layers.arp) this.voice(voices.arp, hz(ev.arp), t, ev.arp.len * sec * 0.8, LAYER.arp, out);
    if (ev.pad) for (const n of ev.pad) this.voice("pad", hz(n), t, n.len * sec, LAYER.pad, out);
    if (ev.hat && layers.hats) {
      if (ev.hat !== "+") this.hat(t, 1, out);
      if (ev.hat !== "x") this.hat(t + sec / 2, 0.7, out);
    }
    const kit = (tok: string | undefined, on: boolean, level: number, a = NO_ACCENT): void => {
      if (tok && on) for (const k of tok) this.drum(k, t, out, level * a.level, sec, a);
    };
    if (def.id === "menu") {
      kit(ev.drum, layers.drums, KIT.menu);
    } else {
      const a = strokeAccent(step);
      kit(ev.drum, layers.drums, KIT.groove[this.intensity], a);
      kit(ev.answer, layers.answers, KIT.answers, a);
      kit(ev.roll, layers.rolls, KIT.rolls, a);
    }
  }

  /** One synthesized note from a patch. */
  private voice(id: InstrumentId, freq: number, t: number, dur: number, level: number, out: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = PATCHES[id];
    const peak = p.gain * level;
    const end = t + Math.max(dur, p.attack + 0.02);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + p.attack);
    amp.gain.setTargetAtTime(peak * p.sustain, t + p.attack, p.decay / 3);
    amp.gain.setTargetAtTime(0.0001, end, p.release / 3);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = p.q;
    filter.frequency.value = p.cutoff * (1 + p.cutoffEnv);
    filter.frequency.setValueAtTime(p.cutoff * (1 + p.cutoffEnv), t);
    filter.frequency.setTargetAtTime(p.cutoff, t + p.attack, p.decay / 2);
    filter.connect(amp).connect(out);
    const stopAt = end + p.release + 0.05;
    const oscs: OscillatorNode[] = [];
    const a = ctx.createOscillator();
    a.type = p.wave;
    a.frequency.value = freq;
    a.connect(filter);
    oscs.push(a);
    if (p.wave2) {
      const b = ctx.createOscillator();
      b.type = p.wave2;
      b.frequency.value = freq * Math.pow(2, p.oct2 ?? 0);
      b.detune.value = p.detune2 ?? 0;
      const mix = ctx.createGain();
      mix.gain.value = p.mix2 ?? 0.5;
      b.connect(mix).connect(filter);
      oscs.push(b);
    }
    if (p.vibrato && dur > p.vibrato.delay + 0.05) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = p.vibrato.rate;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.setValueAtTime(0, t + p.vibrato.delay);
      depth.gain.linearRampToValueAtTime(freq * (Math.pow(2, p.vibrato.cents / 1200) - 1), t + p.vibrato.delay + 0.2);
      lfo.connect(depth);
      for (const o of oscs) depth.connect(o.frequency);
      lfo.start(t);
      lfo.stop(stopAt);
    }
    for (const o of oscs) {
      o.start(t);
      o.stop(stopAt);
    }
    this.notesScheduled++;
  }

  private hat(t: number, accent: number, out: AudioNode): void {
    const arabic = this.edition === "arabic";
    // Classic: a closed hat. Islamic: the jingles of a riq.
    this.noiseAt(t, arabic ? 0.07 : 0.035, {
      vol: LAYER.hat * accent * (arabic ? 1.2 : 1),
      type: arabic ? "bandpass" : "highpass",
      freq: arabic ? 8500 : 7000,
      q: arabic ? 2.5 : 0.7,
      out,
    });
  }

  /**
   * One drum stroke (see the drum letters in music.ts). `sec` is the step's
   * length, which a roll fills; `a.tune` scales the skins' pitch and
   * `a.slap` the stick's slap (see strokeAccent). Each stroke is 2-5 nodes
   * from shared buffers and the cached skin wave: nothing is allocated per
   * hit.
   */
  private drum(kind: string, t: number, out: AudioNode, level: number, sec: number, a = NO_ACCENT): void {
    const ghost = kind === kind.toLowerCase();
    const v = LAYER.drum * level * (ghost ? 0.45 : 1);
    const { tune, slap } = a;
    const skin = (f0: number, f1: number, dur: number, vol: number, hold?: number): void =>
      this.membrane(t, f0 * tune, f1 * tune, dur, vol, out, hold);
    switch (kind.toUpperCase()) {
      // ---- The menu's darbuka
      case "D": // dum: deep centre stroke of a darbuka
        this.toneAt(t, 95, 0.28, { type: "sine", slideTo: 62, vol: v, out });
        this.noiseAt(t, 0.05, { vol: v * 0.25, type: "lowpass", freq: 500, out, brown: true });
        break;
      case "T": // tak: crisp rim slap
        this.noiseAt(t, 0.06, { vol: v * 0.55, type: "bandpass", freq: 2600, q: 2.2, out });
        this.toneAt(t, 720, 0.035, { type: "triangle", vol: v * 0.2, out });
        break;
      // ---- Classic war drums
      case "B": // big war drum: a deep skin and the slap of the stick
        // Its loud first part is short (and the dum's below), so a deploy
        // thump or a hit that lands on it still comes through.
        skin(122, 66, 0.75, v * 0.8, 0.18);
        this.noiseAt(t, 0.06, { vol: v * 0.55 * slap, type: "bandpass", freq: 650, q: 0.55, out });
        break;
      case "L": // low war tom
        skin(170, 118, 0.4, v * 0.8);
        this.noiseAt(t, 0.03, { vol: v * 0.18, type: "bandpass", freq: 1800, q: 1, out });
        break;
      case "H": // high war tom
        skin(245, 175, 0.32, v * 0.75);
        this.noiseAt(t, 0.025, { vol: v * 0.16, type: "bandpass", freq: 2400, q: 1, out });
        break;
      case "S": // snare: a tight skin and the rattle of its wires
        skin(235, 175, 0.12, v * 0.55);
        this.noiseAt(t, 0.15, { vol: v * slap, type: "bandpass", freq: 2000, q: 0.7, out });
        break;
      case "R": // snare roll: four strokes growing across the step
        this.rollNoise(t, sec, 4, v * 0.75, 2000, 0.7, out);
        break;
      case "C": // stick click on the rim
        this.toneAt(t, 1750, 0.035, { type: "triangle", slideTo: 1500, vol: v * 0.48, out });
        break;
      // ---- Golden Age war drums
      case "U": // tabl dum: the big drum's deep head, struck with the beater
        skin(116, 74, 0.55, v * 0.92, 0.18);
        this.noiseAt(t, 0.05, { vol: v * 0.55 * slap, type: "bandpass", freq: 700, q: 0.6, out });
        break;
      case "A": // tabl tak: the thin stick on the other head
        this.noiseAt(t, 0.05, { vol: v * slap, type: "bandpass", freq: 2900, q: 1.6, out });
        skin(440, 380, 0.06, v * 0.55);
        break;
      case "N": // naqqara, the low kettle
        skin(240, 205, 0.16, v * 0.75);
        break;
      case "Q": // naqqara, the high kettle
        skin(360, 315, 0.12, v * 0.7);
        break;
      case "Z": // naqqara roll: high and low in turn across the step
        this.rollSkin(t, sec, 4, v * 0.6, 360 * tune, 240 * tune, out);
        break;
      case "F": // daf: a low frame-drum stroke and its ringing jingles
        skin(135, 92, 0.32, v * 0.7);
        this.noiseAt(t, 0.22, { vol: v * 0.22, type: "bandpass", freq: 7200, q: 1.4, out });
        break;
      default:
        return;
    }
    this.drumHits++;
  }

  /**
   * A struck skin: the cached drum wave chirping down from the stick's
   * attack to `f0`, then sinking to `f1` as it rings for `dur` seconds,
   * loud for the first `hold` of it, then a softer tail. Two nodes.
   */
  private membrane(t0: number, f0: number, f1: number, dur: number, vol: number, out: AudioNode, hold = 0.25): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    if (this.drumWave) osc.setPeriodicWave(this.drumWave);
    else osc.type = "triangle";
    osc.frequency.value = f0 * 1.5;
    osc.frequency.setValueAtTime(f0 * 1.5, t0);
    osc.frequency.exponentialRampToValueAtTime(f0, t0 + 0.015);
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.002);
    gain.gain.exponentialRampToValueAtTime(vol * 0.3, t0 + dur * hold);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /**
   * Gain bumps for `n` strokes across `sec` seconds, each louder than the
   * last (the last at `vol`), on one gain: a roll costs its nodes once, not
   * per stroke. Returns the stroke times.
   */
  private strokes(g: AudioParam, t0: number, sec: number, n: number, vol: number): number[] {
    const gap = sec / n;
    const times: number[] = [];
    let floor = 0.0001;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * gap;
      const v = vol * (0.55 + (0.45 * i) / Math.max(1, n - 1));
      g.setValueAtTime(floor, t);
      g.linearRampToValueAtTime(v, t + 0.002);
      const last = i === n - 1;
      floor = last ? 0.0005 : v * 0.08;
      g.exponentialRampToValueAtTime(floor, t + (last ? Math.max(gap, 0.12) : gap * 0.9));
      times.push(t);
    }
    return times;
  }

  /** A roll on one noise source (a snare): three nodes for the whole step. */
  private rollNoise(t0: number, sec: number, n: number, vol: number, freq: number, q: number, out: AudioNode): void {
    const ctx = this.ctx;
    const buffer = this.noiseWhite;
    if (!ctx || !buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    this.strokes(gain.gain, t0, sec, n, vol);
    src.connect(filter).connect(gain).connect(out);
    const span = Math.min(sec + 0.2, buffer.duration);
    src.start(t0, Math.random() * (buffer.duration - span), span);
  }

  /** A roll on one skin that alternates two pitches (a naqqara pair): two nodes. */
  private rollSkin(t0: number, sec: number, n: number, vol: number, hi: number, lo: number, out: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    if (this.drumWave) osc.setPeriodicWave(this.drumWave);
    else osc.type = "triangle";
    const gain = ctx.createGain();
    gain.gain.value = 0;
    this.strokes(gain.gain, t0, sec, n, vol).forEach((t, i) => {
      const f = i % 2 ? lo : hi;
      osc.frequency.setValueAtTime(f * 1.3, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.012);
    });
    osc.connect(gain).connect(out);
    osc.start(t0);
    osc.stop(t0 + sec + 0.2);
  }

  // ---- One-shot primitives ----------------------------------------------------

  /** Drop repeats of the same sound within `ms` so swarms don't deafen. */
  private throttled(key: string, ms: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return true;
    const now = ctx.currentTime * 1000;
    const last = this.lastPlayed.get(key) ?? -Infinity;
    if (now - last < ms) return true;
    this.lastPlayed.set(key, now);
    return false;
  }

  private sfxOff(): boolean {
    const p = getPrefs();
    return p.muted || p.sfx <= 0 || p.master <= 0;
  }

  private tone(
    freq: number,
    duration: number,
    opts: { type?: OscillatorType; vol?: number; slideTo?: number; delay?: number; out?: AudioNode } = {},
  ): void {
    const ctx = this.ensure();
    if (!ctx || this.sfxOff()) return;
    this.toneAt(ctx.currentTime + (opts.delay ?? 0), freq, duration, opts);
  }

  private toneAt(
    t0: number,
    freq: number,
    duration: number,
    opts: { type?: OscillatorType; vol?: number; slideTo?: number; out?: AudioNode; attack?: number } = {},
  ): void {
    const ctx = this.ctx;
    const out = opts.out ?? this.out;
    if (!ctx || !out) return;
    const { type = "square", vol = 0.18, slideTo, attack = 0.004 } = opts;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.type = type;
    osc.frequency.value = freq;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + duration);
    }
    // A few ms of attack: no clicks on hard-edged waves.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + Math.max(duration, attack + 0.01));
    osc.connect(gain).connect(out);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  private noise(
    duration: number,
    opts: { vol?: number; filterFreq?: number; delay?: number; type?: BiquadFilterType; q?: number; sweepTo?: number; brown?: boolean; attack?: number } = {},
  ): void {
    const ctx = this.ensure();
    if (!ctx || this.sfxOff()) return;
    this.noiseAt(ctx.currentTime + (opts.delay ?? 0), duration, { ...opts, freq: opts.filterFreq });
  }

  /** Filtered noise from the cached buffers, at a random offset. */
  private noiseAt(
    t0: number,
    duration: number,
    opts: { vol?: number; freq?: number; type?: BiquadFilterType; q?: number; sweepTo?: number; brown?: boolean; attack?: number; out?: AudioNode } = {},
  ): void {
    const ctx = this.ctx;
    const out = opts.out ?? this.out;
    const buffer = opts.brown ? this.noiseBrown : this.noiseWhite;
    if (!ctx || !out || !buffer) return;
    const { vol = 0.2, freq = 1200, type = "lowpass", q = 0.7, attack = 0.003 } = opts;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    // Set the cutoff from time 0, not at t0: a highpass whose cutoff jumps
    // from the 350 Hz default on the very sample the noise starts spikes
    // ~20 dB over its level.
    filter.frequency.value = freq;
    if (opts.sweepTo !== undefined) {
      filter.frequency.setValueAtTime(freq, t0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(30, opts.sweepTo), t0 + duration);
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + Math.max(duration, attack + 0.01));
    src.connect(filter).connect(gain).connect(out);
    const span = Math.min(duration + 0.05, buffer.duration);
    src.start(t0, Math.random() * (buffer.duration - span), span);
  }

  /** Route the one-shots of `fn` through a panner at `pan`. */
  private panned(pan: number, fn: () => void): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || pan === 0 || typeof ctx.createStereoPanner !== "function") {
      fn();
      return;
    }
    const node = ctx.createStereoPanner();
    node.pan.value = pan;
    node.connect(this.sfxBus);
    this.out = node;
    try {
      fn();
    } finally {
      this.out = this.sfxBus;
    }
    setTimeout(() => node.disconnect(), 3000);
  }

  // ---- Battle sounds ------------------------------------------------------------

  /** Synth "voice" bark per character, layered over the deploy thump. */
  private bark(cardId: CardId, vol: number): void {
    switch (cardId) {
      case "hog-rider": // a long falling war cry
        this.tone(640, 0.5, { type: "sawtooth", slideTo: 210, vol: 0.2 * vol });
        this.tone(320, 0.5, { type: "square", slideTo: 110, vol: 0.1 * vol, delay: 0.04 });
        break;
      case "witch": // three-note cackle
        for (let i = 0; i < 3; i++) {
          this.tone(820 - i * 150, 0.09, { type: "square", vol: 0.12 * vol, delay: i * 0.09 });
        }
        break;
      case "knight":
      case "giant": // low determined grunt (deeper for the giant)
        this.tone(cardId === "giant" ? 105 : 150, 0.22, {
          type: "sine",
          slideTo: cardId === "giant" ? 60 : 95,
          vol: 0.22 * vol,
        });
        break;
      case "valkyrie": // rising battle cry
        this.tone(360, 0.3, { type: "sawtooth", slideTo: 700, vol: 0.16 * vol });
        break;
      case "prince": // pony whinny: fast trill
        for (let i = 0; i < 4; i++) {
          this.tone(1000 + (i % 2) * 350, 0.07, { type: "sine", vol: 0.1 * vol, delay: i * 0.06 });
        }
        break;
      case "pekka":
      case "mini-pekka": // metal clank + servo hum
        this.noise(0.07, { vol: 0.2 * vol, filterFreq: 3500 });
        this.tone(220, 0.3, { type: "sawtooth", slideTo: 330, vol: 0.1 * vol, delay: 0.05 });
        break;
      case "wizard": // confident "ha!" with a fire hiss
        this.tone(300, 0.14, { type: "square", slideTo: 200, vol: 0.14 * vol });
        this.noise(0.18, { vol: 0.1 * vol, filterFreq: 2400, delay: 0.05 });
        break;
      default:
        break;
    }
  }

  private deploy(cost: number, vol: number): void {
    const pitch = deployPitch(cost);
    this.tone(pitch, 0.12 + cost * 0.012, {
      type: "sine",
      slideTo: pitch * 0.42,
      vol: (0.22 + cost * 0.012) * vol,
    });
    this.tone(pitch * 1.5, 0.08, { type: "triangle", vol: 0.12 * vol, delay: 0.03 });
    this.noise(0.09, { vol: 0.1 * vol, filterFreq: 700, brown: true });
  }

  private melee(): void {
    if (this.throttled("melee", 90)) return;
    this.noise(0.06, { vol: 0.22, filterFreq: 2500 });
    this.tone(140, 0.07, { type: "sine", slideTo: 70, vol: 0.2 });
  }

  private ranged(): void {
    if (this.throttled("ranged", 90)) return;
    this.tone(950, 0.09, { type: "square", slideTo: 300, vol: 0.07 });
    this.noise(0.05, { vol: 0.08, filterFreq: 4000 });
  }

  private towerShot(): void {
    if (this.throttled("tower", 120)) return;
    this.tone(520, 0.1, { type: "triangle", slideTo: 200, vol: 0.1 });
  }

  private fireball(): void {
    this.noise(0.25, { vol: 0.3, filterFreq: 900 });
    this.tone(180, 0.5, { type: "sine", slideTo: 35, vol: 0.4, delay: 0.05 });
    this.noise(0.45, { vol: 0.3, filterFreq: 350, delay: 0.06, brown: true });
  }

  private zap(): void {
    this.noise(0.08, { vol: 0.25, filterFreq: 6000 });
    this.tone(2400, 0.12, { type: "sawtooth", slideTo: 300, vol: 0.18 });
    this.tone(1200, 0.16, { type: "square", slideTo: 150, vol: 0.1, delay: 0.02 });
  }

  private rage(): void {
    // Rising aggressive swell.
    this.tone(180, 0.5, { type: "sawtooth", slideTo: 520, vol: 0.16 });
    this.tone(90, 0.5, { type: "square", slideTo: 260, vol: 0.12, delay: 0.04 });
  }

  private freeze(): void {
    // Glassy descending shimmer.
    for (let i = 0; i < 4; i++) {
      this.tone(1800 - i * 320, 0.3, { type: "sine", slideTo: 900 - i * 150, vol: 0.1, delay: i * 0.06 });
    }
    this.noise(0.35, { vol: 0.08, filterFreq: 7000 });
  }

  private arrows(): void {
    for (let i = 0; i < 3; i++) {
      this.noise(0.1, { vol: 0.12, filterFreq: 5000, delay: i * 0.07 });
      this.tone(1400 - i * 200, 0.08, { type: "square", slideTo: 500, vol: 0.05, delay: i * 0.07 });
    }
  }

  private death(small: boolean): void {
    if (this.throttled("death", 120)) return;
    this.tone(small ? 600 : 300, 0.15, { type: "triangle", slideTo: small ? 200 : 80, vol: 0.14 });
  }

  /** The Digger dives in: a spade crunch and a rumble running off underground. */
  private dig(vol: number): void {
    this.noise(0.12, { vol: 0.24 * vol, filterFreq: 1600, type: "bandpass", q: 1.2 });
    this.noise(0.9, { vol: 0.2 * vol, filterFreq: 220, brown: true, delay: 0.06, attack: 0.08 });
    this.tone(90, 0.7, { type: "sine", slideTo: 55, vol: 0.12 * vol, delay: 0.06 });
  }

  /** Popping out of the ground: a bright cartoon pop over a burst of soil. */
  private pop(): void {
    if (this.throttled("pop", 80)) return;
    this.tone(260, 0.12, { type: "sine", slideTo: 880, vol: 0.24 });
    this.tone(660, 0.08, { type: "triangle", slideTo: 1320, vol: 0.1, delay: 0.05 });
    this.noise(0.22, { vol: 0.2, filterFreq: 900, brown: true });
  }

  /** The Comet comes in: a rising roar that swells into its landing (1.8 s). */
  private whoosh(): void {
    this.noise(1.75, { vol: 0.16, type: "bandpass", filterFreq: 300, sweepTo: 2600, q: 1.1, attack: 1.4 });
    this.noise(1.75, { vol: 0.1, filterFreq: 500, brown: true, attack: 1.5 });
    this.tone(220, 1.7, { type: "sawtooth", slideTo: 110, vol: 0.04, delay: 0.1 });
  }

  /** The Comet lands: a deep boom, a rumble and crackling rock. */
  private boom(): void {
    this.tone(120, 0.9, { type: "sine", slideTo: 28, vol: 0.5 });
    this.noise(1.1, { vol: 0.42, filterFreq: 300, brown: true });
    this.noise(0.4, { vol: 0.22, filterFreq: 2200, sweepTo: 400, delay: 0.03 });
    for (let i = 0; i < 4; i++) this.noise(0.05, { vol: 0.12, filterFreq: 3800, delay: 0.12 + i * 0.07 });
  }

  /** Stone breaking up: a gravelly rumble and clacking chunks (smaller for a pebble). */
  private crumble(big: boolean): void {
    if (this.throttled(big ? "crumble" : "crumble-small", 90)) return;
    const k = big ? 1 : 0.55;
    this.noise(big ? 0.8 : 0.35, { vol: 0.3 * k, filterFreq: 420, brown: true });
    const clacks = big ? 5 : 3;
    for (let i = 0; i < clacks; i++) {
      this.noise(0.04, { vol: 0.16 * k, filterFreq: 2600 - i * 250, type: "bandpass", q: 2, delay: 0.04 + i * 0.06 });
    }
    this.tone(big ? 70 : 140, 0.4, { type: "sine", slideTo: big ? 35 : 70, vol: 0.2 * k });
  }

  /** A Stone Golem lands: grinding stone under the deploy thump. */
  private grind(vol: number): void {
    this.noise(0.5, { vol: 0.2 * vol, filterFreq: 600, type: "bandpass", q: 0.9, sweepTo: 250 });
    this.tone(70, 0.4, { type: "sawtooth", slideTo: 45, vol: 0.08 * vol, delay: 0.05 });
  }

  private towerDown(): void {
    this.noise(0.9, { vol: 0.38, filterFreq: 260, brown: true });
    this.noise(0.5, { vol: 0.16, filterFreq: 1800, sweepTo: 300, delay: 0.05 });
    this.tone(120, 0.6, { type: "sawtooth", slideTo: 40, vol: 0.22 });
  }

  /** Your King wakes: an alarm horn. Theirs wakes: a short defiant roar. */
  private kingWake(mine: boolean): void {
    if (mine) {
      this.tone(98, 0.7, { type: "sawtooth", slideTo: 147, vol: 0.28 });
      this.tone(49, 0.7, { type: "square", slideTo: 73, vol: 0.18, delay: 0.05 });
      this.noise(0.3, { vol: 0.12, filterFreq: 500, delay: 0.1 });
    } else {
      this.tone(147, 0.45, { type: "sawtooth", slideTo: 196, vol: 0.2 });
      this.noise(0.25, { vol: 0.1, filterFreq: 900, delay: 0.05 });
    }
  }

  /** A crowd: several bands of noise, swelling and flickering like voices. */
  private crowd(cheer: boolean): void {
    const ctx = this.ensure();
    if (!ctx || this.sfxOff()) return;
    const t = ctx.currentTime;
    const bands = cheer ? [900, 1500, 2400] : [380, 600];
    bands.forEach((f, i) => {
      const len = cheer ? 1.5 : 1.3;
      this.noiseAt(t + 0.05 + i * 0.06, len, {
        vol: (cheer ? 0.11 : 0.13) / (1 + i * 0.3),
        type: "bandpass",
        freq: f,
        q: 1.4,
        sweepTo: cheer ? f * 1.15 : f * 0.6,
        attack: cheer ? 0.25 : 0.35,
      });
    });
    if (!cheer) {
      // A chorus of falling "ohhh"s.
      for (const [f, d] of [[196, 0], [233, 0.05], [175, 0.1]] as const) {
        this.tone(f, 1.1, { type: "sawtooth", slideTo: f * 0.72, vol: 0.035, delay: d + 0.08 });
      }
    }
  }

  /** Our crown: rising fanfare + cheer. Their crown: low horn + groan. */
  private crown(cue: "cheer" | "groan"): void {
    if (cue === "cheer") {
      const notes = this.edition === "arabic" ? [294, 370, 440, 587] : [523, 659, 784, 1047];
      notes.forEach((f, i) => this.tone(f, 0.18, { type: "square", vol: 0.12, delay: i * 0.09 }));
      this.tone(notes[3], 0.5, { type: "triangle", vol: 0.12, delay: 0.36 });
    } else {
      this.tone(110, 0.9, { type: "sawtooth", slideTo: 92, vol: 0.2 });
      this.tone(55, 0.9, { type: "square", slideTo: 46, vol: 0.12, delay: 0.03 });
    }
    this.crowd(cue === "cheer");
  }

  private ability(): void {
    this.noise(0.4, { vol: 0.14, type: "bandpass", filterFreq: 600, sweepTo: 3000, q: 1.5 });
    this.tone(392, 0.14, { type: "square", vol: 0.12, delay: 0.12 });
    this.tone(587, 0.3, { type: "triangle", vol: 0.15, delay: 0.24 });
  }

  /** Countdown beeps before the battle; `go` is the final higher one. */
  countdownBeep(go: boolean): void {
    this.tone(go ? 880 : 440, go ? 0.35 : 0.15, { type: "square", vol: 0.18 });
    if (go) this.tone(1320, 0.3, { type: "triangle", vol: 0.08, delay: 0.02 });
  }

  /** A soft woodblock tick for each of the last 10 seconds (brighter for the last 3). */
  clockTick(secondsLeft: number): void {
    const urgent = secondsLeft <= 3;
    this.tone(urgent ? 1760 : 1320, 0.05, { type: "triangle", vol: urgent ? 0.2 : 0.13 });
    this.noise(0.03, { vol: urgent ? 0.06 : 0.035, type: "bandpass", filterFreq: 2500, q: 3 });
  }

  /**
   * Banner sting (last minute / overtime) with no argument; with a rarity,
   * the reveal sting for a card or reward of that rarity.
   */
  sting(rarity?: Rarity): void {
    if (rarity === undefined) {
      this.tone(392, 0.14, { type: "square", vol: 0.14 });
      this.tone(523, 0.14, { type: "square", vol: 0.14, delay: 0.12 });
      this.tone(659, 0.26, { type: "square", vol: 0.16, delay: 0.24 });
      return;
    }
    const tier = rarityTier(rarity);
    const notes = this.edition === "arabic" ? [587, 698, 880, 1175, 1397] : [659, 784, 988, 1319, 1568];
    const count = 2 + tier;
    for (let i = 0; i < count; i++) {
      this.tone(notes[i], 0.22 + (i === count - 1 ? 0.35 : 0), { type: i % 2 ? "triangle" : "square", vol: 0.11, delay: i * 0.08 });
    }
    if (tier >= 1) this.noise(0.6 + tier * 0.3, { vol: 0.05 + tier * 0.02, type: "highpass", filterFreq: 6000, delay: 0.1, attack: 0.15 });
    this.duckFor(0.6 + count * 0.12);
  }

  /** Flat denial buzz for an invalid play. */
  error(): void {
    if (this.throttled("error", 200)) return;
    this.tone(160, 0.12, { type: "square", slideTo: 110, vol: 0.12 });
    this.tone(120, 0.14, { type: "sawtooth", slideTo: 90, vol: 0.09, delay: 0.02 });
  }

  /** Soft drip when elixir sits at max and starts leaking. */
  elixirLeak(): void {
    if (this.throttled("leak", 900)) return;
    this.tone(880, 0.08, { type: "sine", slideTo: 440, vol: 0.08 });
    this.tone(660, 0.1, { type: "sine", slideTo: 330, vol: 0.06, delay: 0.06 });
  }

  /** Bubbly pop for emotes. */
  emotePop(): void {
    this.tone(700, 0.1, { type: "sine", slideTo: 1200, vol: 0.18 });
  }

  // ---- UI and reward one-shots (called by screens with optional chaining) ----

  /** A soft click for any button. */
  uiTap(): void {
    if (this.throttled("ui", 45)) return;
    this.tone(1250, 0.045, { type: "sine", slideTo: 950, vol: 0.15 });
    this.noise(0.015, { vol: 0.05, type: "highpass", filterFreq: 5000 });
  }

  /** Back / close: the click, falling. */
  uiBack(): void {
    if (this.throttled("ui", 45)) return;
    this.tone(900, 0.05, { type: "sine", slideTo: 650, vol: 0.13 });
    this.tone(620, 0.06, { type: "sine", slideTo: 480, vol: 0.1, delay: 0.045 });
  }

  /** A wooden chest rattling on its hinges. */
  chestShake(): void {
    if (this.throttled("chest-shake", 120)) return;
    for (let i = 0; i < 3; i++) {
      this.noise(0.05, { vol: 0.16 - i * 0.03, type: "bandpass", filterFreq: 520 + i * 90, q: 3, delay: i * 0.065 });
      this.tone(170 + i * 12, 0.05, { type: "triangle", vol: 0.08, delay: i * 0.065 });
    }
  }

  /** The lid bursts open: a whoosh, a thump and a bright shimmer. */
  chestOpen(): void {
    this.noise(0.45, { vol: 0.18, type: "bandpass", filterFreq: 400, sweepTo: 4200, q: 1.2 });
    this.tone(110, 0.25, { type: "sine", slideTo: 55, vol: 0.3, delay: 0.02 });
    const chord = this.edition === "arabic" ? [587, 740, 880, 1175] : [784, 988, 1175, 1568];
    chord.forEach((f, i) => this.tone(f, 0.7, { type: "triangle", vol: 0.07, delay: 0.18 + i * 0.03 }));
    this.noise(0.9, { vol: 0.05, type: "highpass", filterFreq: 7500, delay: 0.2, attack: 0.1 });
    this.duckFor(1.4);
  }

  /** A card turning over; its rarity rings out after the flick. */
  cardFlip(rarity?: Rarity): void {
    this.noise(0.06, { vol: 0.12, type: "highpass", filterFreq: 3000, sweepTo: 6000 });
    const tier = rarityTier(rarity ?? "common");
    const base = this.edition === "arabic" ? 587 : 659;
    for (let i = 0; i <= tier; i++) {
      this.tone(base * Math.pow(2, (i * 4) / 12), 0.25 + tier * 0.08, { type: "triangle", vol: 0.1, delay: 0.06 + i * 0.07 });
    }
    if (tier >= 2) this.noise(0.6, { vol: 0.05, type: "highpass", filterFreq: 8000, delay: 0.12, attack: 0.1 });
  }

  /** "New card!": a sparkling run up two octaves. */
  newCard(): void {
    const run = this.edition === "arabic" ? [294, 370, 440, 587, 740, 880, 1175] : [523, 659, 784, 1047, 1319, 1568, 2093];
    run.forEach((f, i) => this.tone(f, i === run.length - 1 ? 0.5 : 0.12, { type: i % 2 ? "triangle" : "square", vol: 0.08, delay: i * 0.06 }));
    this.noise(0.8, { vol: 0.05, type: "highpass", filterFreq: 8000, delay: 0.3, attack: 0.1 });
    this.duckFor(1.2);
  }

  /** A reward claimed: two quick coin chimes. */
  claim(): void {
    if (this.throttled("claim", 80)) return;
    this.tone(1319, 0.09, { type: "square", vol: 0.07 });
    this.tone(1976, 0.3, { type: "triangle", vol: 0.1, delay: 0.07 });
    this.noise(0.04, { vol: 0.04, type: "highpass", filterFreq: 6000, delay: 0.07 });
  }

  private jingle(kind: "win" | "lose" | "draw"): void {
    this.playMusic("none");
    const arabic = this.edition === "arabic";
    const seqs = {
      // Classic: a major fanfare. Islamic: the same shape in Hijaz.
      win: arabic ? [294, 311, 370, 440, 587, 440, 587] : [523, 659, 784, 1047, 784, 1047],
      lose: [392, 370, 330, 262],
      draw: [440, 440],
    } as const;
    const seq = seqs[kind];
    seq.forEach((f, i) =>
      this.tone(f, i === seq.length - 1 ? 0.5 : 0.22, {
        type: i % 2 ? "triangle" : "square",
        vol: 0.15,
        delay: i * 0.16,
      }),
    );
    if (kind === "lose") this.tone(131, 0.9, { type: "sawtooth", slideTo: 98, vol: 0.12, delay: 0.5 });
    if (kind !== "draw") this.crowd(kind === "win");
  }

  // ---- Battle events --------------------------------------------------------

  /** Which side the local player controls (the online guest is 'enemy'). */
  setLocalSide(side: Side): void {
    this.localSide = side;
  }

  get side(): Side {
    return this.localSide;
  }

  /** Map a battle event to its sound, from the local side's point of view. */
  onEvent(ev: BattleEvent, mySide: Side = this.localSide): void {
    if (!this.ctx) return;
    const pan = "x" in ev ? panFor(ev.x, mySide) : 0;
    this.panned(pan, () => this.dispatch(ev, mySide));
  }

  private dispatch(ev: BattleEvent, mySide: Side): void {
    const wave = waveCue(ev);
    if (wave === "pop") return this.pop();
    if (wave === "whoosh") return this.whoosh();
    if (wave === "boom") return this.boom();
    if (wave === "crumble" || wave === "crumble-small") return this.crumble(wave === "crumble");
    switch (ev.type) {
      case "ability":
        this.ability();
        break;
      case "deploy": {
        // The opponent's plays sit a little further back in the mix.
        const vol = ev.side === mySide ? 1 : 0.7;
        if (wave === "dig") {
          this.dig(vol); // it goes straight underground: no landing thump
          break;
        }
        this.deploy(getCard(ev.cardId).cost, vol);
        this.bark(ev.cardId, vol);
        if (wave === "grind") this.grind(vol);
        break;
      }
      case "spell":
        if (ev.cardId === "fireball") this.fireball();
        else if (ev.cardId === "zap") this.zap();
        else if (ev.cardId === "rage") this.rage();
        else if (ev.cardId === "freeze") this.freeze();
        else this.arrows();
        break;
      case "attack":
        if (ev.kind !== "troop") this.towerShot();
        else if (ev.ranged) this.ranged();
        else this.melee();
        break;
      case "death":
        if (ev.kind !== "troop") this.towerDown();
        else if (ev.cardId === "balloon") this.fireball(); // death bomb
        else this.death(ev.cardId === "skeletons");
        break;
      case "crown":
        this.crown(crownCue(ev.winner, mySide));
        break;
      case "king-wake":
        this.kingWake(ev.side === mySide);
        break;
      case "finish":
        this.jingle(jingleFor(ev.winner, mySide));
        break;
    }
  }
}

/** 0 common, 1 rare, 2 epic, 3 legendary (or better). */
export function rarityTier(rarity: string): 0 | 1 | 2 | 3 {
  switch (rarity) {
    case "rare":
      return 1;
    case "epic":
      return 2;
    case "legendary":
    case "champion":
      return 3;
    default:
      return 0;
  }
}
