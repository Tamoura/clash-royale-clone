/**
 * The guided first battle as a pure step machine. Each step waits for one
 * thing the player must do (deploy the Knight, cast the Fireball…); a
 * "hold" step freezes the sim until they do it, so nobody is rushed. The
 * index of the next step is saved as each step completes, so a reload
 * resumes the lesson where it stopped.
 *
 * The UI (src/ui/tutorialOverlay.ts) feeds battle events, taps and frames
 * in, and draws the pointer, mask and coach bubble from the current step.
 */
import { ARENA_HEIGHT, RIVER_Y } from "./arena";
import { effectiveCard, type BattleEvent, type BattleState, type Entity } from "./battle";
import type { CardId } from "./cards";
import { TUTORIAL_CHALLENGE, type Challenge } from "./challenges";

export const TUTORIAL_KEY = "cr-clone-tutorial";
/** The pre-tutorial "has seen the first-battle tips" flag; "1" counts as done. */
export const TUTORED_KEY = "cr-clone-tutored";

/** The next step to play (0..6), or "done". */
export type TutorialProgress = number | "done";

/** What the machine is fed: battle events, a tap on a callout, or a frame. */
export type TutorialInput = BattleEvent | { type: "tap" } | { type: "frame" };

/** A card to play and the arena tile (sim coordinates) to play it on. */
export interface TutorialTarget {
  cardId: CardId;
  x: number;
  y: number;
}

export interface TutorialStep {
  id: string;
  /** True when this input (or the state it leaves) completes the step. */
  waitFor: (input: TutorialInput, state: BattleState) => boolean;
  /** Freeze the sim while the step waits (see stepHolds for the gates). */
  hold: boolean;
  /** Extra gate on hold: only freeze once this is true (the moment to act). */
  holdWhen?: (state: BattleState) => boolean;
  /** The play the pointer demonstrates; null when there is none right now. */
  target?: (state: BattleState) => TutorialTarget | null;
  /** HUD element a callout points at instead of a card. */
  anchor?: "elixir" | "ability";
  /** The step is a callout the player taps through. */
  tapToContinue?: boolean;
  /** Coach text: [English, Arabic]. */
  text: [string, string];
  /** Shown instead while the step has nothing to point at yet. */
  idleText?: [string, string];
  /** Runs once when the step becomes current (may adjust the battle). */
  enter?: (state: BattleState) => void;
}

// ---- Board helpers -----------------------------------------------------------

const playerDeployed = (i: TutorialInput, id: CardId): boolean =>
  (i.type === "deploy" || i.type === "spell") && i.side === "player" && i.cardId === id;

const enemyTroops = (s: BattleState): Entity[] =>
  s.entities.filter((e) => e.side === "enemy" && e.kind === "troop");

/** True when the player could play `id` right now. */
export function canPlay(s: BattleState, id: CardId): boolean {
  if (!s.player.hand.cards.includes(id)) return false;
  const eff = effectiveCard(s, "player", id);
  return eff !== null && eff.cost <= s.player.elixir.amount;
}

/** Scripted wave times (see TUTORIAL_CHALLENGE.waves). */
const GIANT_AT = TUTORIAL_CHALLENGE.waves[0].at;
const CLUSTER_AT = TUTORIAL_CHALLENGE.waves[1].at;
/** Which step each wave belongs to; a resumed lesson skips earlier ones. */
const WAVE_STEP = [1, 3, 3];

/** The scripted Giant once it has crossed onto the player's half. */
function crossedGiant(s: BattleState): Entity | undefined {
  return enemyTroops(s).find((e) => e.cardId === "giant" && e.y >= RIVER_Y + 1.5);
}

/** The cluster the Fireball lesson is about, once it is on the player's half. */
function clusterCentre(s: BattleState): { x: number; y: number } | null {
  const pack = enemyTroops(s).filter((e) => e.cardId === "archers");
  if (pack.length < 2) return null;
  const x = pack.reduce((a, e) => a + e.x, 0) / pack.length;
  const y = pack.reduce((a, e) => a + e.y, 0) / pack.length;
  return y >= RIVER_Y + 1.5 ? { x, y } : null;
}

const pushing = (s: BattleState): boolean =>
  s.entities.some((e) => e.side === "player" && e.cardId === "giant");

/** Where the Knight lesson's glowing tile sits: in front of the left tower. */
export const KNIGHT_TILE = { x: 3.5, y: ARENA_HEIGHT - 11.5 };
/** The defend spot: beside the right tower, in range of the Giant's path. */
export const DEFEND_TILE = { x: 11.5, y: ARENA_HEIGHT - 5.5 };
/** The push lane: just behind the left bridge. */
export const PUSH_TILE = { x: 3.5, y: ARENA_HEIGHT - 13 };

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "deploy",
    hold: true,
    waitFor: (i) => playerDeployed(i, "knight"),
    target: () => ({ cardId: "knight", ...KNIGHT_TILE }),
    text: [
      "Drag the Knight onto the glowing tile to send him into battle.",
      "اسحب الفارس إلى المربع المضيء ليدخل المعركة.",
    ],
  },
  {
    id: "defend",
    hold: true,
    holdWhen: (s) => crossedGiant(s) !== undefined,
    waitFor: (i, s) =>
      playerDeployed(i, "musketeer") ||
      (i.type === "frame" && s.time > GIANT_AT + 2 && !enemyTroops(s).some((e) => e.cardId === "giant")),
    target: (s) => (crossedGiant(s) ? { cardId: "musketeer", ...DEFEND_TILE } : null),
    idleText: ["Your Knight marches on. Keep an eye on the other bridge!", "فارسك يتقدّم. راقب الجسر الآخر!"],
    text: [
      "A Giant is coming for your tower! Drop the Musketeer here to shoot it down.",
      "عملاق يتجه نحو برجك! ضع الرامية هنا لتُسقطه.",
    ],
  },
  {
    id: "elixir",
    hold: true,
    anchor: "elixir",
    tapToContinue: true,
    waitFor: (i) => i.type === "tap",
    text: [
      "This is your elixir. Every card costs some, and it refills over time. Keep spending it!",
      "هذا هو الإكسير. كل بطاقة تكلّف بعضه، ويمتلئ مع الوقت. لا تتركه يضيع!",
    ],
  },
  {
    id: "spell",
    hold: true,
    holdWhen: (s) => clusterCentre(s) !== null,
    waitFor: (i, s) =>
      playerDeployed(i, "fireball") ||
      (i.type === "frame" && s.time > CLUSTER_AT + 2 && !enemyTroops(s).some((e) => e.cardId === "archers")),
    target: (s) => {
      const c = clusterCentre(s);
      return c ? { cardId: "fireball", ...c } : null;
    },
    idleText: ["Your Musketeer and tower team up on the Giant. Get ready…", "الرامية وبرجك يتعاونان على العملاق. استعد…"],
    text: [
      "Archers in a bunch! Throw a Fireball on them to hit them all at once.",
      "رماة متجمّعون! ألقِ كرة النار عليهم لتصيبهم جميعًا.",
    ],
  },
  {
    id: "push",
    hold: true,
    holdWhen: (s) => !pushing(s),
    waitFor: (i) => i.type === "crown" && i.winner === "player",
    target: (s) => (pushing(s) ? null : { cardId: "giant", ...PUSH_TILE }),
    idleText: ["Your Giant heads for their tower. Back him up with more troops!", "عملاقك يتجه نحو برجهم. ادعمه بمزيد من الجنود!"],
    text: [
      "Your turn to attack! Send the Giant over the bridge and knock down a tower.",
      "دورك في الهجوم! أرسل العملاق عبر الجسر وأسقط برجًا.",
    ],
  },
  {
    id: "king",
    hold: true,
    anchor: "ability",
    waitFor: (i, s) =>
      (i.type === "ability" && i.side === "player") || (i.type === "tap" && s.player.ability === null),
    enter: (s) => {
      // The lesson needs a full meter, whatever the clock says.
      if (s.player.ability) s.player.abilityCharge = 1;
    },
    text: [
      "Their King woke up! Your King has a power too: tap it now.",
      "استيقظ ملكهم! لملكك قوة أيضًا: اضغطها الآن.",
    ],
  },
  {
    id: "win",
    hold: false,
    waitFor: (i) => i.type === "finish" && i.winner === "player",
    text: [
      "Finish it: bring down the King tower to win!",
      "أنهِ المعركة: أسقط برج الملك لتفوز!",
    ],
  },
];

export const TUTORIAL_STEP_COUNT = TUTORIAL_STEPS.length;

// ---- Persistence ---------------------------------------------------------------

export interface TutorialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Set once the tutorial win has paid out, so a replay never pays again. */
export const TUTORIAL_PAID_KEY = "cr-clone-tutorial-paid";

/** A storage that is missing or throws behaves like an empty one. */
function safeGet(storage: TutorialStorage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: TutorialStorage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // storage unavailable: progress lives for this session only
  }
}

function defaultStorage(): TutorialStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadTutorialProgress(storage = defaultStorage()): TutorialProgress {
  if (safeGet(storage, TUTORED_KEY) === "1") return "done";
  const raw = safeGet(storage, TUTORIAL_KEY);
  if (raw === "done") return "done";
  const n = raw === null ? 0 : Number(raw);
  return Number.isInteger(n) && n >= 0 && n < TUTORIAL_STEP_COUNT ? n : 0;
}

export function tutorialDone(storage = defaultStorage()): boolean {
  return loadTutorialProgress(storage) === "done";
}

/** Finished or skipped: never show the tutorial (or the old tips) again. */
export function markTutorialDone(storage = defaultStorage()): void {
  safeSet(storage, TUTORIAL_KEY, "done");
  safeSet(storage, TUTORED_KEY, "1");
}

/** Forget that the tutorial was finished, so it can be played again. */
export function resetTutorial(storage = defaultStorage()): void {
  for (const k of [TUTORIAL_KEY, TUTORED_KEY]) {
    try {
      storage?.removeItem?.(k);
    } catch {
      // storage unavailable: nothing to reset
    }
  }
}

/** Has the tutorial win already paid its trophies, gold and chest? */
export function tutorialPaid(storage = defaultStorage()): boolean {
  return safeGet(storage, TUTORIAL_PAID_KEY) === "1";
}

export function markTutorialPaid(storage = defaultStorage()): void {
  safeSet(storage, TUTORIAL_PAID_KEY, "1");
}

// ---- The machine ---------------------------------------------------------------

/** Should `step` freeze the sim right now? */
export function stepHolds(step: TutorialStep, s: BattleState): boolean {
  if (!step.hold || s.result) return false;
  if (step.holdWhen && !step.holdWhen(s)) return false;
  // Never freeze on a play the player cannot make: let elixir refill (or
  // the card cycle back) and hold again once it is possible.
  const t = step.target?.(s);
  if (step.target && (!t || !canPlay(s, t.cardId))) return false;
  if (step.anchor === "ability" && s.player.ability && s.player.abilityCharge < 1) return false;
  return true;
}

export class Tutorial {
  private progress: TutorialProgress;
  private entered = -1;

  constructor(private readonly storage: TutorialStorage | undefined = defaultStorage()) {
    this.progress = loadTutorialProgress(storage);
  }

  /** The next step to complete, or "done". */
  get step(): TutorialProgress {
    return this.progress;
  }

  get current(): TutorialStep | null {
    return this.progress === "done" ? null : TUTORIAL_STEPS[this.progress];
  }

  get done(): boolean {
    return this.progress === "done";
  }

  /** Run the current step's enter() once (call when the battle is live). */
  enter(s: BattleState): void {
    if (typeof this.progress !== "number" || this.entered === this.progress) return;
    this.entered = this.progress;
    this.current?.enter?.(s);
  }

  /** Feed one input; returns true when it completed the current step. */
  feed(input: TutorialInput, s: BattleState): boolean {
    const step = this.current;
    if (!step || !step.waitFor(input, s)) return false;
    const next = (this.progress as number) + 1;
    this.progress = next >= TUTORIAL_STEP_COUNT ? "done" : next;
    if (this.progress === "done") markTutorialDone(this.storage);
    else safeSet(this.storage, TUTORIAL_KEY, String(this.progress));
    this.enter(s);
    return true;
  }

  /** Does the current step freeze the sim right now? */
  holds(s: BattleState): boolean {
    const step = this.current;
    return step !== null && stepHolds(step, s);
  }

  skip(): void {
    this.progress = "done";
    markTutorialDone(this.storage);
  }
}

/**
 * The tutorial battle's challenge from step `from` on: waves that belong to
 * lessons already learned are left out of a resumed battle.
 */
export function tutorialChallenge(from: number): Challenge {
  return {
    ...TUTORIAL_CHALLENGE,
    waves: TUTORIAL_CHALLENGE.waves.filter((_, i) => WAVE_STEP[i] >= from),
  };
}

/** Battle tweaks the challenge format cannot express (the weakened King). */
export function prepareTutorialBattle(s: BattleState, ch: Challenge = TUTORIAL_CHALLENGE): void {
  if (ch.enemyKingHp === undefined) return;
  for (const e of s.entities) {
    if (e.side === "enemy" && e.kind === "king-tower") {
      // Both, so the King reads as full health and does not wake early.
      e.hp = ch.enemyKingHp;
      e.maxHp = ch.enemyKingHp;
    }
  }
}
