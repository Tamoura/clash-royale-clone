/**
 * Banners & match phases: the centre banner, the "VS" splash and the
 * 3-2-1-FIGHT countdown that gates the sim at the start of each match.
 *
 * Banners go through a small priority queue so two messages never fight
 * over the same spot: a countdown beat beats a phase call ("Last minute"),
 * which beats a coaching tip, which beats plain info. A higher priority
 * replaces what is showing at once; anything else waits its turn, every
 * banner gets at least BANNER_MIN_MS on screen, and a message that is
 * already showing or waiting is not queued twice.
 */
import type { SoundEngine } from "../audio/sound";
import { ABILITIES, type AbilityId } from "../game/abilities";
import type { BattleState } from "../game/battle";
import { TOWER_TROOPS, type TowerTroopId } from "../game/towers";
import { fmtNum, tr } from "./i18n";
import { icon } from "./icons";
import { reducedMotion } from "./prefs";

export type MatchPhase = "countdown" | "playing";

let phase: MatchPhase = "countdown";
let countdownStep = 4; // 3, 2, 1, FIGHT!
let countdownTimer = 0;
let lastMinuteShown = false;
let overtimeShown = false;

export const getPhase = (): MatchPhase => phase;
export function setPhase(p: MatchPhase): void {
  phase = p;
}

/** True when decorative motion should be skipped (the motion pref, or the OS). */
export const reduceMotion = (): boolean => reducedMotion();

// ---- Priority queue (pure, unit-tested) -------------------------------------

export type BannerPriority = "countdown" | "phase" | "tip" | "info";

export interface BannerOpts {
  priority?: BannerPriority;
  /** The large countdown style. */
  big?: boolean;
}

export interface BannerItem {
  text: string;
  priority: BannerPriority;
  big: boolean;
  /** When it was queued (ms). */
  at: number;
}

const RANK: Record<BannerPriority, number> = { countdown: 3, phase: 2, tip: 1, info: 0 };

/** Shortest time any banner stays up before a waiting one replaces it. */
export const BANNER_MIN_MS = 900;
/** How long a banner stays up when nothing is waiting (its CSS animation). */
export const BANNER_SHOW_MS = 1600;
/** Tips and info that waited this long are stale and dropped. */
export const BANNER_STALE_MS = 6000;

export class BannerQueue {
  current: (BannerItem & { shownAt: number }) | null = null;
  readonly waiting: BannerItem[] = [];

  /**
   * Offer a banner. Returns "show" when it should be drawn right now,
   * "queued" when it waits for the current one, "dropped" for a duplicate.
   */
  push(text: string, opts: BannerOpts, now: number): "show" | "queued" | "dropped" {
    const item: BannerItem = { text, priority: opts.priority ?? "info", big: !!opts.big, at: now };
    const cur = this.live(now);
    if (cur && cur.text === text) return "dropped";
    const dup = this.waiting.find((w) => w.text === text);
    if (dup) {
      // Keep the stronger claim on the slot.
      if (RANK[item.priority] > RANK[dup.priority]) {
        this.waiting.splice(this.waiting.indexOf(dup), 1);
        this.insert({ ...dup, priority: item.priority, big: dup.big || item.big });
      }
      return "dropped";
    }
    if (!cur || this.preempts(item, cur)) {
      this.current = { ...item, shownAt: now };
      return "show";
    }
    this.insert(item);
    return "queued";
  }

  /** The next waiting banner if its turn has come, else null. */
  poll(now: number): BannerItem | null {
    this.dropStale(now);
    if (this.waiting.length === 0) return null;
    const cur = this.live(now);
    if (cur && now - cur.shownAt < BANNER_MIN_MS) return null;
    const next = this.waiting.shift()!;
    this.current = { ...next, shownAt: now };
    return next;
  }

  /** When poll() can next return something (ms), or null with nothing waiting. */
  nextPollAt(now: number): number | null {
    if (this.waiting.length === 0) return null;
    const cur = this.live(now);
    return cur ? Math.max(now, cur.shownAt + BANNER_MIN_MS) : now;
  }

  clear(): void {
    this.current = null;
    this.waiting.length = 0;
  }

  private live(now: number): (BannerItem & { shownAt: number }) | null {
    if (this.current && now - this.current.shownAt >= BANNER_SHOW_MS) this.current = null;
    return this.current;
  }

  /** Higher priority cuts in; countdown beats also replace each other. */
  private preempts(item: BannerItem, cur: BannerItem): boolean {
    if (item.priority === "countdown" && cur.priority === "countdown") return true;
    return RANK[item.priority] > RANK[cur.priority];
  }

  /** Highest priority first; first come, first served within a priority. */
  private insert(item: BannerItem): void {
    let i = this.waiting.length;
    while (i > 0 && RANK[this.waiting[i - 1].priority] < RANK[item.priority]) i--;
    this.waiting.splice(i, 0, item);
  }

  private dropStale(now: number): void {
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      const w = this.waiting[i];
      if (RANK[w.priority] <= RANK.tip && now - w.at > BANNER_STALE_MS) this.waiting.splice(i, 1);
    }
  }
}

// ---- DOM driver -----------------------------------------------------------------

const queue = new BannerQueue();
let bannerEl: HTMLElement | null = null;
let pollTimer = 0;

function draw(item: BannerItem): void {
  bannerEl ??= document.getElementById("banner");
  if (!bannerEl) return;
  bannerEl.textContent = item.text;
  bannerEl.dataset.priority = item.priority;
  bannerEl.classList.remove("show");
  bannerEl.classList.toggle("countdown", item.big);
  void bannerEl.offsetWidth; // restart the CSS animation
  bannerEl.classList.add("show");
}

function schedule(): void {
  window.clearTimeout(pollTimer);
  const at = queue.nextPollAt(performance.now());
  if (at === null) return;
  pollTimer = window.setTimeout(() => {
    const next = queue.poll(performance.now());
    if (next) draw(next);
    schedule();
  }, Math.max(0, at - performance.now()) + 16);
}

/**
 * Show a centre banner. Text must already be translated (pass a tr() result).
 * The legacy boolean second argument means { big: true }.
 */
export function showBanner(text: string, opts: BannerOpts | boolean = {}): void {
  const o: BannerOpts = typeof opts === "boolean" ? { big: opts, priority: opts ? "countdown" : "info" } : opts;
  if (queue.push(text, o, performance.now()) === "show") {
    draw({ text, priority: o.priority ?? "info", big: !!o.big, at: 0 });
  }
  schedule();
}

/** Forget queued banners (a new match is starting). */
export function clearBanners(): void {
  queue.clear();
  window.clearTimeout(pollTimer);
}

/** A stable stand-in for the bot's trophies: the ladder pairs you with your level. */
export function botTrophies(myTrophies: number): number {
  return Math.max(0, Math.round(myTrophies));
}

/** CR-style "VS" splash before a match: you vs the opponent, 1.6 s. */
export function showVersus(
  opponent: string,
  me: { trophies: number; towerTroop: TowerTroopId; ability: AbilityId },
  foeTrophies = botTrophies(me.trophies),
): void {
  if (reduceMotion()) return;
  document.querySelector(".versus")?.remove();
  const vs = document.createElement("div");
  vs.className = "versus";
  vs.setAttribute("aria-hidden", "true");
  const ability = ABILITIES[me.ability];
  const side = (cls: string, name: string, meta: string): HTMLElement => {
    const el = document.createElement("div");
    el.className = `versus-side ${cls}`;
    const n = document.createElement("div");
    n.className = "versus-name";
    n.textContent = name;
    const m = document.createElement("div");
    m.className = "versus-meta";
    m.innerHTML = meta;
    el.append(n, m);
    return el;
  };
  const mid = document.createElement("div");
  mid.className = "versus-vs";
  mid.textContent = tr("VS", "ضد");
  const troop = TOWER_TROOPS[me.towerTroop];
  vs.append(
    side("foe", opponent || tr("Bot", "الروبوت"), `${icon("trophy")} ${fmtNum(foeTrophies)}`),
    mid,
    side(
      "me",
      tr("You", "أنت"),
      `${icon("trophy")} ${fmtNum(me.trophies)} ${icon("shield")} ${tr(troop.name, troop.ar)} · ${tr(ability.name, ability.ar)}`,
    ),
  );
  document.body.appendChild(vs);
  window.setTimeout(() => vs.remove(), 1650);
}

export function startCountdown(withVersus = false): void {
  phase = "countdown";
  countdownStep = 4;
  countdownTimer = withVersus && !reduceMotion() ? 1.7 : 0;
  lastMinuteShown = false;
  overtimeShown = false;
  clearBanners();
}

export function tickCountdown(dt: number, audio: SoundEngine): void {
  countdownTimer -= dt;
  if (countdownTimer > 0) return;
  countdownTimer = 0.85;
  countdownStep -= 1;
  if (countdownStep > 0) {
    showBanner(fmtNum(countdownStep), { priority: "countdown", big: true });
    audio.countdownBeep(false);
  } else {
    showBanner(tr("FIGHT!", "انطلق!"), { priority: "countdown", big: true });
    audio.countdownBeep(true);
    phase = "playing";
  }
}

export function checkBanners(battle: BattleState, audio: SoundEngine): void {
  if (!lastMinuteShown && battle.time >= 120 && !battle.result) {
    lastMinuteShown = true;
    showBanner(tr("Last minute — 2x elixir!", "الدقيقة الأخيرة — إكسير مضاعف!"), { priority: "phase" });
    audio.sting();
  }
  if (!overtimeShown && battle.overtime && !battle.result) {
    overtimeShown = true;
    showBanner(tr("OVERTIME!", "وقت إضافي!"), { priority: "phase" });
    audio.sting();
  }
}
