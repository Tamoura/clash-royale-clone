import type { BattleEvent } from "../game/battle";

/**
 * Fully synthesized game audio (Web Audio API) — no audio files.
 * Call resume() from a user gesture before expecting any sound.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private lastPlayed = new Map<string, number>();
  muted = false;

  private ensure(): AudioContext | null {
    if (typeof AudioContext === "undefined") return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.12;
      this.musicGain.connect(this.master);
    }
    return this.ctx;
  }

  /** Unlock audio from a user gesture and start the background tune. */
  resume(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    this.startMusic();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

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

  private tone(
    freq: number,
    duration: number,
    opts: {
      type?: OscillatorType;
      vol?: number;
      slideTo?: number;
      delay?: number;
      out?: AudioNode;
    } = {},
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const { type = "square", vol = 0.18, slideTo, delay = 0 } = opts;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + duration);
    }
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(opts.out ?? this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noise(
    duration: number,
    opts: { vol?: number; filterFreq?: number; delay?: number } = {},
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const { vol = 0.2, filterFreq = 1200, delay = 0 } = opts;
    const t0 = ctx.currentTime + delay;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
  }

  private deploy(): void {
    this.tone(420, 0.12, { type: "sine", slideTo: 180, vol: 0.25 });
    this.tone(620, 0.08, { type: "triangle", vol: 0.12, delay: 0.03 });
  }

  private melee(): void {
    if (this.throttled("melee", 90)) return;
    this.noise(0.06, { vol: 0.22, filterFreq: 2500 });
    this.tone(140, 0.07, { type: "sine", slideTo: 70, vol: 0.2 });
  }

  private ranged(): void {
    if (this.throttled("ranged", 90)) return;
    this.tone(950, 0.09, { type: "square", slideTo: 300, vol: 0.08 });
    this.noise(0.05, { vol: 0.08, filterFreq: 4000 });
  }

  private towerShot(): void {
    if (this.throttled("tower", 120)) return;
    this.tone(520, 0.1, { type: "triangle", slideTo: 200, vol: 0.1 });
  }

  private fireball(): void {
    this.noise(0.25, { vol: 0.3, filterFreq: 900 });
    this.tone(180, 0.5, { type: "sine", slideTo: 35, vol: 0.4, delay: 0.05 });
    this.noise(0.4, { vol: 0.25, filterFreq: 350, delay: 0.06 });
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

  private arrows(): void {
    for (let i = 0; i < 3; i++) {
      this.noise(0.1, { vol: 0.12, filterFreq: 5000, delay: i * 0.07 });
      this.tone(1400 - i * 200, 0.08, {
        type: "square",
        slideTo: 500,
        vol: 0.05,
        delay: i * 0.07,
      });
    }
  }

  private death(small: boolean): void {
    if (this.throttled("death", 120)) return;
    this.tone(small ? 600 : 300, 0.15, {
      type: "triangle",
      slideTo: small ? 200 : 80,
      vol: 0.14,
    });
  }

  private towerDown(): void {
    this.noise(0.6, { vol: 0.35, filterFreq: 250 });
    this.tone(120, 0.6, { type: "sawtooth", slideTo: 40, vol: 0.25 });
  }

  private kingWake(): void {
    // Low war-horn blast with a growl underneath.
    this.tone(98, 0.7, { type: "sawtooth", slideTo: 147, vol: 0.3 });
    this.tone(49, 0.7, { type: "square", slideTo: 73, vol: 0.2, delay: 0.05 });
    this.noise(0.3, { vol: 0.12, filterFreq: 500, delay: 0.1 });
  }

  private crown(): void {
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((f, i) =>
      this.tone(f, 0.16, { type: "square", vol: 0.14, delay: i * 0.09 }),
    );
    // Crowd cheer: a swell of filtered noise.
    this.noise(0.7, { vol: 0.18, filterFreq: 1500, delay: 0.1 });
    this.noise(0.5, { vol: 0.12, filterFreq: 2600, delay: 0.25 });
  }

  /** Countdown beeps before the battle; `go` is the final higher one. */
  countdownBeep(go: boolean): void {
    this.tone(go ? 880 : 440, go ? 0.35 : 0.15, { type: "square", vol: 0.2 });
  }

  /** Short sting for banners (last minute / overtime). */
  sting(): void {
    this.tone(392, 0.14, { type: "square", vol: 0.16 });
    this.tone(523, 0.14, { type: "square", vol: 0.16, delay: 0.12 });
    this.tone(659, 0.26, { type: "square", vol: 0.18, delay: 0.24 });
  }

  /** Bubbly pop for emotes. */
  emotePop(): void {
    this.tone(700, 0.1, { type: "sine", slideTo: 1200, vol: 0.18 });
  }

  private jingle(kind: "win" | "lose" | "draw"): void {
    this.stopMusic();
    const seqs = {
      win: [523, 659, 784, 1047, 784, 1047],
      lose: [392, 370, 330, 262],
      draw: [440, 440],
    } as const;
    seqs[kind].forEach((f, i) =>
      this.tone(f, 0.22, {
        type: i % 2 ? "triangle" : "square",
        vol: 0.16,
        delay: i * 0.16,
      }),
    );
  }

  /** A tiny 16-step medieval-ish loop: bass drone + lead melody. */
  private startMusic(): void {
    if (this.musicTimer !== null || !this.ctx) return;
    const lead = [440, 0, 523, 440, 587, 523, 440, 0, 392, 0, 440, 523, 440, 392, 330, 0];
    const bass = [110, 0, 110, 0, 147, 0, 110, 0, 98, 0, 98, 0, 110, 0, 110, 0];
    const stepMs = 220;
    this.musicTimer = window.setInterval(() => {
      if (this.muted || !this.musicGain) return;
      const i = this.musicStep % 16;
      if (lead[i]) {
        this.tone(lead[i], 0.18, { type: "triangle", vol: 0.5, out: this.musicGain });
      }
      if (bass[i]) {
        this.tone(bass[i], 0.3, { type: "sine", vol: 0.7, out: this.musicGain });
      }
      this.musicStep++;
    }, stepMs);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  restartMusic(): void {
    this.musicStep = 0;
    this.startMusic();
  }

  /** Map a battle event to its sound. */
  onEvent(ev: BattleEvent): void {
    if (!this.ctx) return;
    switch (ev.type) {
      case "deploy":
        this.deploy();
        break;
      case "spell":
        if (ev.cardId === "fireball") this.fireball();
        else if (ev.cardId === "zap") this.zap();
        else if (ev.cardId === "rage") this.rage();
        else this.arrows();
        break;
      case "attack":
        if (ev.kind !== "troop") this.towerShot();
        else if (ev.ranged) this.ranged();
        else this.melee();
        break;
      case "death":
        if (ev.kind === "troop") this.death(ev.cardId === "skeletons");
        else this.towerDown();
        break;
      case "crown":
        this.crown();
        break;
      case "king-wake":
        this.kingWake();
        break;
      case "finish":
        this.jingle(
          ev.winner === "player" ? "win" : ev.winner === "enemy" ? "lose" : "draw",
        );
        break;
    }
  }
}
