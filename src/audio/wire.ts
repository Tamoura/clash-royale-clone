/**
 * Audio and haptics wiring: subscribes the sound engine and buzz() to the
 * app hooks, so main.ts only has to import this module.
 *
 * - screen: the menu theme on the home diorama and the other menus, nothing
 *   while a battle screen waits for its countdown.
 * - matchStart: remember the local side (the online guest is 'enemy'), then
 *   start the battle track the frame the countdown ends.
 * - frame: the clock ticks in the last 10 seconds, and a tap of haptics
 *   when the local towers take damage.
 * - battleEvent / matchEnd / input: haptics, the results duck.
 * - Any button tap clicks (back buttons click "back") and buzzes lightly.
 *
 * The SoundEngine plays battle events itself (main.ts feeds it every event
 * via onEvent); setLocalSide makes those cues side-aware.
 */
import type { Side } from "../game/arena";
import type { BattleState } from "../game/battle";
import { BATTLE_DURATION, OVERTIME_DURATION } from "../game/sim";
import { on } from "../app/hooks";
import { buzz } from "../ui/feel";
import { clockTickDue, type MusicId } from "./music";
import { existingSoundEngine } from "./sound";

/** Music for a screen: battle screens wait for the countdown (silence). */
export function musicForScreen(sceneMode: "battle" | "diorama" | "none"): MusicId | null {
  // Opaque menus (collection, chests, deck…) keep the menu theme going:
  // stopping and restarting it on every tab switch would be the new grate.
  return sceneMode === "battle" ? null : "menu";
}

/** Seconds left on the match clock (regulation, then overtime). */
export function secondsLeft(b: Pick<BattleState, "time" | "overtime">): number {
  return (b.overtime ? BATTLE_DURATION + OVERTIME_DURATION : BATTLE_DURATION) - b.time;
}

function towerHp(b: BattleState, side: Side): number {
  let hp = 0;
  for (const e of b.entities) {
    if (e.side === side && (e.kind === "princess-tower" || e.kind === "king-tower")) hp += Math.max(0, e.hp);
  }
  return hp;
}

let mySide: Side = "player";
let inMatch = false;
let armed = false;
let replay = false;
let lastTick = -1;
let watched: BattleState | null = null;
let lastHp = 0;

on("screen", ({ sceneMode }) => {
  const s = existingSoundEngine();
  const music = musicForScreen(sceneMode);
  if (music === null) return; // the battle track follows the countdown
  inMatch = false;
  armed = false;
  s?.duck(false);
  s?.playMusic(music);
});

on("matchStart", ({ mySide: side, battle, replay: isReplay }) => {
  const s = existingSoundEngine();
  mySide = side;
  inMatch = true;
  armed = true;
  replay = isReplay;
  lastTick = -1;
  watched = battle;
  lastHp = towerHp(battle, side);
  s?.setLocalSide(side);
  s?.setIntensity(0);
  s?.duck(false);
  s?.playMusic("none");
});

on("frame", ({ phase, battle }) => {
  if (!inMatch || !battle) return;
  const s = existingSoundEngine();
  if (battle.result) {
    armed = false;
    return;
  }
  if (armed && phase === "playing") {
    armed = false;
    s?.playMusic("battle");
  }
  if (phase !== "playing") return;
  const tick = clockTickDue(lastTick, secondsLeft(battle));
  if (tick !== null) {
    lastTick = tick;
    s?.clockTick(tick);
  }
  // A light tap whenever one of our towers is hurt (throttled in feel.ts).
  if (watched !== battle) {
    watched = battle;
    lastHp = towerHp(battle, mySide);
  }
  const hp = towerHp(battle, mySide);
  if (hp < lastHp && !replay) buzz("towerHit");
  lastHp = hp;
});

on("battleEvent", ({ ev }) => {
  if (replay) return;
  if (ev.type === "death" && (ev.kind === "princess-tower" || ev.kind === "king-tower")) buzz("towerDown");
  else if (ev.type === "king-wake") buzz("king");
});

on("matchEnd", ({ winner, mySide: side, replay: isReplay }) => {
  const s = existingSoundEngine();
  inMatch = false;
  armed = false;
  s?.playMusic("none");
  s?.duck(true);
  if (isReplay || winner === "draw") return;
  buzz(winner === side ? "victory" : "defeat");
});

on("input", ({ kind }) => {
  if (kind === "emote") return;
  if (kind === "select") existingSoundEngine()?.uiTap();
  buzz(kind);
});

// ---- Every button answers a tap ------------------------------------------

const TAPPABLE = 'button, [role="button"], a[href], summary, label.ui-seg, [data-tap]';
const BACKISH = /^(back|close|cancel|done)\b|رجوع|إغلاق|عودة/i;

function isBack(el: Element): boolean {
  if (el.matches(".back-btn, .icon-back, [data-back]") || el.querySelector(".icon-back")) return true;
  const label = el.getAttribute("aria-label") ?? "";
  return BACKISH.test(label.trim());
}

if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (ev) => {
      const target = ev.target instanceof Element ? ev.target.closest(TAPPABLE) : null;
      if (!target || (target as HTMLButtonElement).disabled) return;
      // Emotes pop and battle cards have their own feedback (input hook).
      if (target.closest("#emotes, [data-no-tap]") || target.matches("#hud button.card")) return;
      const s = existingSoundEngine();
      if (isBack(target)) s?.uiBack();
      else s?.uiTap();
      buzz("select");
    },
    { capture: true, passive: true },
  );
}

// Dev aid for the audio acceptance checks (stripped from prod builds).
if (import.meta.env?.DEV && typeof window !== "undefined") {
  (window as unknown as { __crAudio: unknown }).__crAudio = () => existingSoundEngine();
}
