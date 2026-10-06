/**
 * Banners & match phases: the centre banner, the "VS" splash and the
 * 3-2-1-FIGHT countdown that gates the sim at the start of each match.
 */
import type { SoundEngine } from "../audio/sound";
import { ABILITIES, type AbilityId } from "../game/abilities";
import type { BattleState } from "../game/battle";
import { TOWER_TROOPS, type TowerTroopId } from "../game/towers";
import { tr } from "./i18n";
import { icon } from "./icons";

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

export const reduceMotion = (): boolean =>
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let bannerEl: HTMLElement | null = null;

export function showBanner(text: string, big = false): void {
  bannerEl ??= document.getElementById("banner")!;
  bannerEl.textContent = text;
  bannerEl.classList.remove("show");
  bannerEl.classList.toggle("countdown", big);
  void bannerEl.offsetWidth; // restart the CSS animation
  bannerEl.classList.add("show");
}

/** CR-style "VS" splash before a match: you vs the opponent, 1.6 s. */
export function showVersus(
  opponent: string,
  me: { trophies: number; towerTroop: TowerTroopId; ability: AbilityId },
): void {
  if (reduceMotion()) return;
  document.querySelector(".versus")?.remove();
  const vs = document.createElement("div");
  vs.className = "versus";
  vs.setAttribute("aria-hidden", "true");
  const ability = ABILITIES[me.ability];
  vs.innerHTML =
    `<div class="versus-side foe"><div class="versus-name">${opponent}</div>` +
    `<div class="versus-meta">${icon("trophy")} ${Math.max(0, me.trophies + Math.round((Math.random() - 0.5) * 60))}</div></div>` +
    `<div class="versus-vs">VS</div>` +
    `<div class="versus-side me"><div class="versus-name">${tr("You", "أنت")}</div>` +
    `<div class="versus-meta">${icon("trophy")} ${me.trophies} ${icon("shield")} ${tr(TOWER_TROOPS[me.towerTroop].name, TOWER_TROOPS[me.towerTroop].ar)} · ${tr(ability.name, ability.ar)}</div></div>`;
  document.body.appendChild(vs);
  window.setTimeout(() => vs.remove(), 1650);
}

export function startCountdown(withVersus = false): void {
  phase = "countdown";
  countdownStep = 4;
  countdownTimer = withVersus && !reduceMotion() ? 1.7 : 0;
  lastMinuteShown = false;
  overtimeShown = false;
}

export function tickCountdown(dt: number, audio: SoundEngine): void {
  countdownTimer -= dt;
  if (countdownTimer > 0) return;
  countdownTimer = 0.85;
  countdownStep -= 1;
  if (countdownStep > 0) {
    showBanner(String(countdownStep), true);
    audio.countdownBeep(false);
  } else {
    showBanner("FIGHT!", true);
    audio.countdownBeep(true);
    phase = "playing";
  }
}

export function checkBanners(battle: BattleState, audio: SoundEngine): void {
  if (!lastMinuteShown && battle.time >= 120 && !battle.result) {
    lastMinuteShown = true;
    showBanner("Last minute — 2x elixir!");
    audio.sting();
  }
  if (!overtimeShown && battle.overtime && !battle.result) {
    overtimeShown = true;
    showBanner("OVERTIME!");
    audio.sting();
  }
}
