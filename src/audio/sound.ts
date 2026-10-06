import { ARENA_WIDTH, type Side } from "../game/arena";
import type { BattleEvent } from "../game/battle";
import { getCard, type CardId } from "../game/cards";
import { ARABIC } from "../render3d/theme";
import { getPrefs, onPrefs, setPrefs, type Prefs } from "../ui/prefs";
import {
  MAX_LOOKAHEAD_SEC,
  MUSIC_FADE_SEC,
  SCHEDULER_TICK_MS,
  TRACKS,
  compileTrack,
  dueSteps,
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
  brass: { wave: "sawtooth", wave2: "sawtooth", oct2: 0, detune2: 8, mix2: 0.7, attack: 0.025, decay: 0.16, sustain: 0.65, release: 0.09, cutoff: 950, cutoffEnv: 2.2, q: 1.6, gain: 0.13 },
  mizmar: { wave: "sawtooth", wave2: "square", oct2: 0, detune2: -6, mix2: 0.35, attack: 0.02, decay: 0.14, sustain: 0.7, release: 0.08, cutoff: 1500, cutoffEnv: 1.3, q: 3.5, vibrato: { rate: 6.2, cents: 22, delay: 0.09 }, gain: 0.17 },
  pluck: { wave: "triangle", wave2: "sine", oct2: -1, mix2: 0.6, attack: 0.005, decay: 0.2, sustain: 0.35, release: 0.08, cutoff: 700, cutoffEnv: 2, q: 1, gain: 0.34 },
  oud: { wave: "sawtooth", wave2: "triangle", oct2: -1, mix2: 0.5, attack: 0.003, decay: 0.14, sustain: 0.18, release: 0.1, cutoff: 520, cutoffEnv: 3.2, q: 2.6, gain: 0.38 },
  harp: { wave: "triangle", attack: 0.004, decay: 0.32, sustain: 0.12, release: 0.25, cutoff: 3200, cutoffEnv: 0.5, q: 0.7, gain: 0.1 },
  qanun: { wave: "triangle", wave2: "sawtooth", oct2: 0, detune2: 3, mix2: 0.3, attack: 0.003, decay: 0.16, sustain: 0.08, release: 0.14, cutoff: 2800, cutoffEnv: 1.2, q: 1.2, gain: 0.1 },
  chip: { wave: "square", attack: 0.004, decay: 0.09, sustain: 0.3, release: 0.05, cutoff: 2400, cutoffEnv: 0.8, q: 0.8, gain: 0.055 },
  pad: { wave: "sine", wave2: "triangle", oct2: 0, detune2: 7, mix2: 0.5, attack: 0.45, decay: 0.6, sustain: 0.8, release: 0.9, cutoff: 1300, cutoffEnv: 0.1, q: 0.6, gain: 0.05 },
};

/** Per-layer levels on top of each patch's own gain. */
const LAYER = { lead: 1, bass: 0.9, arp: 0.85, pad: 1, hat: 0.05, drum: 0.55 } as const;

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
   * The battle track picks it up on its next step: hats and a counter-
   * melody at 1, drums and a faster tempo at 2.
   */
  setIntensity(level: Intensity): void {
    this.intensity = level;
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
    if (this.deck && this.deck.id !== this.wanted) {
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
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + MUSIC_FADE_SEC);
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
    if (ev.lead) this.voice(voices.lead, hz(ev.lead), t, ev.lead.len * sec, LAYER.lead, out);
    if (ev.bass) this.voice(voices.bass, hz(ev.bass), t, ev.bass.len * sec * 0.9, LAYER.bass, out);
    if (ev.arp && layers.arp) this.voice(voices.arp, hz(ev.arp), t, ev.arp.len * sec * 0.8, LAYER.arp, out);
    if (ev.pad) for (const n of ev.pad) this.voice("pad", hz(n), t, n.len * sec, LAYER.pad, out);
    if (ev.hat && layers.hats) {
      if (ev.hat !== "+") this.hat(t, 1, out);
      if (ev.hat !== "x") this.hat(t + sec / 2, 0.7, out);
    }
    if (ev.drum && layers.drums) this.drum(ev.drum, t, out, def.id === "menu" ? 0.45 : 1);
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

  private drum(kind: string, t: number, out: AudioNode, level: number): void {
    const ghost = kind === kind.toLowerCase();
    const v = LAYER.drum * level * (ghost ? 0.45 : 1);
    switch (kind.toUpperCase()) {
      case "K": // kick
        this.toneAt(t, 120, 0.2, { type: "sine", slideTo: 42, vol: v, out });
        break;
      case "S": // snare: body + rattle
        this.toneAt(t, 200, 0.08, { type: "triangle", slideTo: 140, vol: v * 0.45, out });
        this.noiseAt(t, 0.14, { vol: v * 0.5, type: "bandpass", freq: 2200, q: 0.8, out });
        break;
      case "D": // dum: deep centre stroke of a darbuka
        this.toneAt(t, 95, 0.28, { type: "sine", slideTo: 62, vol: v, out });
        this.noiseAt(t, 0.05, { vol: v * 0.25, type: "lowpass", freq: 500, out, brown: true });
        break;
      case "T": // tak: crisp rim slap
        this.noiseAt(t, 0.06, { vol: v * 0.55, type: "bandpass", freq: 2600, q: 2.2, out });
        this.toneAt(t, 720, 0.035, { type: "triangle", vol: v * 0.2, out });
        break;
    }
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
    switch (ev.type) {
      case "ability":
        this.ability();
        break;
      case "deploy": {
        // The opponent's plays sit a little further back in the mix.
        const vol = ev.side === mySide ? 1 : 0.7;
        this.deploy(getCard(ev.cardId).cost, vol);
        this.bark(ev.cardId, vol);
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
