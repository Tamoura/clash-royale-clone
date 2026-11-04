/**
 * Defeat coaching: after a solo ladder loss the result screen shows ONE
 * specific, friendly tip, chosen from what actually happened in the match:
 *
 * 1. elixir leaked (4 or more wasted at a full bar): play cards sooner;
 * 2. a tower fell to a building-targeter (Giant, Hog Rider, Balloon…):
 *    a front troop with shooters behind it;
 * 3. no spell cast all match: the deck's group-clearing spell;
 * 4. otherwise one of a few basics, rotating from loss to loss.
 *
 * chooseCoachTip() is pure (unit-tested); installCoachTips() watches the
 * match through the hook bus and fills a registerResultExtra slot. It is
 * installed by installAutoDifficulty() (difficulty.ts), so main.ts needs
 * no wiring of its own.
 */
import { on, type MatchEndPayload } from "../app/hooks";
import { registerResultExtra } from "../app/slots";
import type { Side } from "../game/arena";
import type { BattleEvent, BattleState } from "../game/battle";
import { getCard, type CardId } from "../game/cards";
import { cardDisplayName } from "../render/cardNames";
import { ARABIC } from "../render3d/theme";
import { tr } from "../ui/i18n";
import { icon } from "../ui/icons";

/** Elixir wasted at a full bar that earns the "play a card" tip. */
export const LEAK_TIP_ELIXIR = 4;
/** A building-targeter this close to a tower as it falls took part in it (tiles). */
const NEAR_TOWER = 4;
export const ROTATION_KEY = "cr-clone-coach-rotation";

export type CoachTipId = "leak" | "building" | "spell" | `basic-${number}`;

export interface CoachTip {
  id: CoachTipId;
  en: string;
  ar: string;
}

/** What the chooser needs to know about the lost match. */
export interface DefeatFacts {
  /** Elixir my side wasted sitting at a full bar. */
  elixirLeaked: number;
  /** One of my towers fell while a building-targeting troop was on it. */
  towerLostToBuildingTargeter: boolean;
  /** Spells I cast this match. */
  spellsCast: number;
  /** My 8 cards. */
  deck: readonly CardId[];
  /** Advances by one per tip shown, to rotate the basics. */
  rotation: number;
}

/** Front-line troops that hold a tower-smasher, best first. */
const FRONT: readonly CardId[] = ["knight", "valkyrie", "mini-pekka", "pekka", "mega-knight", "prince"];
/** Troops that shoot from behind the front line, best first. */
const SHOOTERS: readonly CardId[] = [
  "musketeer",
  "archers",
  "wizard",
  "baby-dragon",
  "executioner",
  "magic-archer",
  "firecracker",
  "electro-wizard",
  "ice-wizard",
  "princess",
  "witch",
];
/** Damage spells that clear a group of little troops, best first. */
const GROUP_SPELLS: readonly CardId[] = ["arrows", "zap", "fireball"];

/** The basics, shown in turn when nothing specific stands out. */
export const BASIC_TIPS: readonly (readonly [string, string])[] = [
  ["Defend first, then attack with the troops that survive!", "دافع أولًا، ثم هاجم بالجنود الذين نجوا!"],
  ["Send a big troop first and put shooters right behind it.", "أرسل جنديًا ضخمًا أولًا وضع الرماة خلفه مباشرة."],
  ["Watch both bridges: enemies can come from either side!", "راقب الجسرين: قد يأتي الأعداء من أي جهة!"],
  ["When your KING glows, tap it for a helping hand!", "عندما يتوهّج زر الملك، اضغطه ليساعدك!"],
];

/**
 * The one tip for a lost match. `nameOf` gives a card's name in the
 * current edition (the default); tests pass the plain names.
 */
export function chooseCoachTip(f: DefeatFacts, nameOf: (id: CardId) => string = cardDisplayName): CoachTip {
  if (f.elixirLeaked >= LEAK_TIP_ELIXIR) {
    return {
      id: "leak",
      en: "Don't let elixir sit at 10, play a card!",
      ar: "لا تترك الإكسير واقفًا عند ١٠، العب بطاقة!",
    };
  }
  if (f.towerLostToBuildingTargeter) {
    const front = FRONT.find((id) => f.deck.includes(id));
    const shooters = SHOOTERS.filter((id) => f.deck.includes(id)).slice(0, 2);
    if (front && shooters.length > 0) {
      const [a, b] = shooters.map(nameOf);
      const k = nameOf(front);
      return {
        id: "building",
        en: b ? `Put ${a} or ${b} behind your ${k}!` : `Put ${a} behind your ${k}!`,
        ar: b ? `ضع ${a} أو ${b} خلف ${k}!` : `ضع ${a} خلف ${k}!`,
      };
    }
    return {
      id: "building",
      en: "Tower-smashers ignore your troops: stop them early, before the bridge!",
      ar: "محطّمو الأبراج يتجاهلون جنودك: أوقفهم مبكرًا قبل الجسر!",
    };
  }
  const spell = GROUP_SPELLS.find((id) => f.deck.includes(id));
  if (f.spellsCast === 0 && spell) {
    const s = nameOf(spell);
    return {
      id: "spell",
      en: `${s} clears groups of little troops`,
      ar: `${s} يزيل مجموعات الجنود الصغار`,
    };
  }
  const n = BASIC_TIPS.length;
  const i = ((Math.floor(f.rotation) % n) + n) % n;
  const [en, ar] = BASIC_TIPS[i];
  return { id: `basic-${i}`, en, ar };
}

/** A solo ladder match I lost (not online, sandbox, replay or a draw). */
export function isCoachedDefeat(s: Pick<MatchEndPayload, "kind" | "online" | "sandbox" | "replay" | "winner" | "mySide">): boolean {
  return s.kind === "ladder" && !s.online && !s.sandbox && !s.replay && s.winner !== "draw" && s.winner !== s.mySide;
}

// ---- Watching a match (pure) ----------------------------------------------------------

/** What the coach has seen of one solo match so far. */
export interface DefeatWatch {
  battle: BattleState;
  mySide: Side;
  spells: number;
  lostToBuilding: boolean;
  /** Building-targeting cards seen hitting each attacked spot ("x,y"). */
  hitBy: Map<string, Set<CardId>>;
}

export function createDefeatWatch(battle: BattleState, mySide: Side): DefeatWatch {
  return { battle, mySide, spells: 0, lostToBuilding: false, hitBy: new Map() };
}

const spot = (x: number, y: number): string => `${Math.round(x * 2)},${Math.round(y * 2)}`;

function buildingTargeter(id: CardId | null): boolean {
  if (!id) return false;
  try {
    const c = getCard(id);
    return c.kind === "troop" && c.unit.targetsBuildingsOnly;
  } catch {
    return false;
  }
}

/**
 * Fold one battle event into the watch: my spells, building-targeters'
 * hits, and whether one of them was on a tower of mine as it fell (still
 * standing next to it, or seen hitting that spot earlier).
 */
export function watchEvent(w: DefeatWatch, ev: BattleEvent): void {
  if (ev.type === "spell" && ev.side === w.mySide) {
    w.spells++;
  } else if (ev.type === "attack" && ev.cardId && buildingTargeter(ev.cardId)) {
    const key = spot(ev.targetX, ev.targetY);
    const set = w.hitBy.get(key) ?? new Set<CardId>();
    set.add(ev.cardId);
    w.hitBy.set(key, set);
  } else if (ev.type === "death" && ev.side === w.mySide && (ev.kind === "princess-tower" || ev.kind === "king-tower")) {
    const near = w.battle.entities.some(
      (e) =>
        e.side !== w.mySide &&
        e.kind === "troop" &&
        e.hp > 0 &&
        e.targetsBuildingsOnly &&
        Math.hypot(e.x - ev.x, e.y - ev.y) <= NEAR_TOWER,
    );
    if (near || (w.hitBy.get(spot(ev.x, ev.y))?.size ?? 0) > 0) w.lostToBuilding = true;
  }
}

/** The chooser's facts for a finished match (watch may be missing: no spell nag then). */
export function defeatFacts(battle: BattleState, mySide: Side, w: DefeatWatch | null, rotation: number): DefeatFacts {
  const me = mySide === "player" ? battle.player : battle.enemy;
  return {
    elixirLeaked: me.stats.elixirLeaked,
    towerLostToBuildingTargeter: w?.lostToBuilding ?? false,
    spellsCast: w?.spells ?? 1,
    deck: [...me.hand.cards, ...me.hand.queue],
    rotation,
  };
}

// ---- Wiring (browser) --------------------------------------------------------------

function loadRotation(): number {
  try {
    const n = Number(localStorage.getItem(ROTATION_KEY));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function saveRotation(n: number): void {
  try {
    localStorage.setItem(ROTATION_KEY, String(n));
  } catch {
    // storage blocked: the basics simply start over
  }
}

function tipElement(tip: CoachTip): HTMLElement {
  const box = document.createElement("div");
  box.className = "ui-coach-tip";
  box.dataset.tip = tip.id;
  box.setAttribute("role", "note");
  if (ARABIC) box.dir = "rtl";
  box.insertAdjacentHTML("beforeend", icon("crown"));
  const text = document.createElement("p");
  text.className = "ui-coach-tip__text";
  const head = document.createElement("b");
  head.textContent = tr("Coach tip", "نصيحة المدرب");
  text.append(head, document.createElement("br"), document.createTextNode(tr(tip.en, tip.ar)));
  box.appendChild(text);
  return box;
}

/**
 * Watch every solo match (spells cast, towers lost and who was on them) and
 * add the chosen tip to the result screen of a lost ladder match.
 */
export function installCoachTips(): () => void {
  let watch: DefeatWatch | null = null;
  // One tip per lost battle, even if the result screen is built twice.
  const shown = new WeakMap<BattleState, CoachTip>();
  const offs = [
    on("matchStart", (m) => {
      watch = m.online || m.replay ? null : createDefeatWatch(m.battle, m.mySide);
    }),
    on("battleEvent", ({ ev }) => {
      if (watch) watchEvent(watch, ev);
    }),
    registerResultExtra((s) => {
      if (!isCoachedDefeat(s)) return null;
      let tip = shown.get(s.battle);
      if (!tip) {
        const w = watch && watch.battle === s.battle ? watch : null;
        const rotation = loadRotation();
        tip = chooseCoachTip(defeatFacts(s.battle, s.mySide, w, rotation));
        if (tip.id.startsWith("basic-")) saveRotation(rotation + 1);
        shown.set(s.battle, tip);
      }
      return tipElement(tip);
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
